use std::time::Instant;

use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::integrations::prime_packs::PrimeModpacksConfig;
use crate::minecraft::api::mc_api::MinecraftApiService;
use crate::minecraft::downloads::java_download::JavaDownloadService;
use crate::minecraft::downloads::mc_assets_download::MinecraftAssetsDownloadService;
use crate::minecraft::downloads::mc_client_download::MinecraftClientDownloadService;
use crate::minecraft::downloads::mc_libraries_download::MinecraftLibrariesDownloadService;
use crate::minecraft::downloads::mc_natives_download::MinecraftNativesDownloadService;
use crate::minecraft::downloads::PrimePackDownloadService;
use crate::minecraft::downloads::{ModDownloadService, PrimeClientAssetsDownloadService};
use crate::minecraft::dto::JavaDistribution;
use crate::minecraft::{MinecraftLaunchParameters, MinecraftLauncher};
use crate::state::event_state::{EventPayload, EventType};
use crate::state::profile_state::{ModLoader, Profile};
use crate::state::state_manager::State;
use log::{error, info, warn};
use rand::Rng;
use uuid::Uuid;

use super::minecraft_auth::Credentials;
use super::modloader::ModloaderFactory;
use crate::minecraft::downloads::MinecraftLoggingDownloadService;
use crate::utils::mc_utils;
use tokio::fs as async_fs;
use base64::{engine::general_purpose::STANDARD, Engine as _};

async fn emit_progress_event(
    state: &State,
    event_type: EventType,
    profile_id: Uuid,
    message: &str,
    progress: f64,
    error: Option<String>,
) -> Result<Uuid> {
    let event_id = Uuid::new_v4();
    state
        .emit_event(EventPayload {
            event_id,
            event_type,
            target_id: Some(profile_id),
            message: message.to_string(),
            progress: Some(progress),
            error,
        })
        .await?;
    Ok(event_id)
}

/// Runs an async step with automatic start/completion events and timing.
/// Emits a start event ("label...") at 0%, runs the closure, then emits
/// a completion event ("label completed! (Xms)") at 100%.
/// The timing also appears in launcher.log via log::info!.
async fn timed_step<F, Fut, T>(
    state: &State,
    event_type: EventType,
    profile_id: Uuid,
    label: &str,
    f: F,
) -> Result<T>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<T>>,
{
    emit_progress_event(state, event_type.clone(), profile_id, &format!("{}...", label), 0.0, None).await?;
    info!("{}", label);
    let start = Instant::now();
    let result = f().await?;
    let elapsed_ms = start.elapsed().as_millis();
    info!("[Timing] {} took {}ms", label, elapsed_ms);
    emit_progress_event(state, event_type, profile_id, &format!("{} completed! ({}ms)", label, elapsed_ms), 1.0, None).await?;
    Ok(result)
}

pub async fn install_minecraft_version(
    version_id: &str,
    modloader_str: &str,
    profile: &Profile,
    credentials: Option<Credentials>,
    quick_play_singleplayer: Option<String>,
    quick_play_multiplayer: Option<String>,
    migration_info: Option<crate::utils::profile_utils::MigrationInfo>,
    extra_local_mods: Vec<std::path::PathBuf>,
) -> Result<()> {
    // Convert string modloader to ModLoader enum
    let modloader_enum = match modloader_str {
        "vanilla" => ModLoader::Vanilla,
        "fabric" => ModLoader::Fabric,
        "forge" => ModLoader::Forge,
        "neoforge" => ModLoader::NeoForge,
        "quilt" => ModLoader::Quilt,
        _ => {
            return Err(AppError::Unknown(format!(
                "Unbekannter Modloader: {}",
                modloader_str
            )))
        }
    };

    // Get version manifest and find the specific version
    info!(
        "Installing Minecraft version: {} with modloader: {:?}",
        version_id, modloader_enum
    );

    let mut profile = profile.clone();

    // Get experimental mode from global config
    let state = State::get().await?;
    let is_experimental_mode = state.config_manager.is_experimental_mode().await;
    let launcher_config = state.config_manager.get_config().await;

    info!(
        "[Launch] Setting experimental mode: {}",
        is_experimental_mode
    );
    info!(
        "[Launch] Using concurrent downloads: {}",
        launcher_config.concurrent_downloads
    );

    let total_start = Instant::now();

    // <--- HARDCODED TEST ERROR (50% CHANCE) --- >
    let should_throw_error = {
        let mut rng = rand::thread_rng(); // Create and use RNG in a tight scope
        rng.gen_bool(0.5) // 0.5 means 50% probability
    }; // rng goes out of scope here

    if should_throw_error {
        info!("[InstallTest] Randomly decided to throw test error.");
        //return Err(AppError::Unknown("Testfehler (50% Chance) für das Error-Handling!".to_string()));
    } else {
        info!("[InstallTest] Randomly decided NOT to throw test error. Proceeding normally.");
    }
    // <--- END HARDCODED TEST ERROR --- >

    // Execute migration if provided
    if let Some(migration) = &migration_info {
        info!("[Launch] Executing migration before installation: {:?}", migration);

        // Execute the migration (detailed progress events are sent from within execute_group_migration)
        match crate::utils::profile_utils::execute_group_migration(migration.clone(), Some(profile.id)).await {
            Ok(_) => {
                info!("[Launch] Migration completed successfully");
            }
            Err(e) => {
                error!("[Launch] Migration failed: {:?}", e);

                // Send migration failed event
                let migration_failed_payload = crate::state::event_state::EventPayload {
                    event_id: uuid::Uuid::new_v4(),
                    event_type: crate::state::event_state::EventType::MigrationFailed,
                    target_id: Some(profile.id),
                    message: format!("Migration failed: {:?}", e),
                    progress: Some(0.0),
                    error: Some(format!("{:?}", e)),
                };

                if let Err(e) = state.event_state.emit(migration_failed_payload).await {
                    warn!("[Launch] Failed to emit migration failed event: {}", e);
                }

                // Return the error to stop the launch process
                return Err(e);
            }
        }
    }

    if let Some(world) = &quick_play_singleplayer {
        info!(
            "[Launch] Quick Play: Launching directly into singleplayer world: {}",
            world
        );
    } else if let Some(server) = &quick_play_multiplayer {
        info!(
            "[Launch] Quick Play: Connecting directly to server: {}",
            server
        );
    }

    let is_online = crate::utils::network_utils::is_network_available();
    info!("[Launch] Network connectivity: {}", is_online);

    let api_service = MinecraftApiService::new();
    let manifest = api_service.get_version_manifest().await?;
    let version = manifest
        .versions
        .iter()
        .find(|v| v.id == version_id)
        .ok_or_else(|| AppError::VersionNotFound(format!("Version {} not found", version_id)))?;

    // Get version metadata
    let piston_meta = api_service.get_piston_meta(&version.url).await?;
    piston_meta.display_info();

    // Get Java version from Minecraft version manifest
    let java_version = piston_meta.java_version.major_version as u32;
    info!("\nChecking Java {} for Minecraft...", java_version);

    // Emit Java installation event
    let event_id = emit_progress_event(
        &state,
        EventType::InstallingJava,
        profile.id,
        &format!("Installing Java {}...", java_version),
        0.0,
        None,
    )
    .await?;

    // Check if profile uses a custom Java path
    let step_start = Instant::now();
    let mut custom_java_valid = false;
    let java_path = if profile.settings.use_custom_java_path && profile.settings.java_path.is_some()
    {
        // Try to use the custom Java path
        let custom_path = profile.settings.java_path.as_ref().unwrap();
        info!("Using custom Java path from profile: {}", custom_path);

        // Verify that the custom Java path exists and is valid
        let path = std::path::PathBuf::from(custom_path);
        if path.exists() {
            // Check if it's a valid Java installation
            use crate::utils::java_detector;
            match java_detector::get_java_info(&path).await {
                Ok(java_info) => {
                    info!(
                        "Verified custom Java: Version {}, Major version {}, 64-bit: {}",
                        java_info.version, java_info.major_version, java_info.is_64bit
                    );

                    // Check if the Java version is compatible with the required one
                    if java_info.major_version >= java_version {
                        info!(
                            "Custom Java version {} meets the required version {}",
                            java_info.major_version, java_version
                        );
                        custom_java_valid = true;
                        path
                    } else {
                        info!(
                            "Custom Java version {} is lower than required version {}. Downloading Java...",
                            java_info.major_version, java_version
                        );
                        // The custom Java is too old, we need to download a newer version
                        custom_java_valid = false;
                        // Will be set by the download code below
                        std::path::PathBuf::new()
                    }
                }
                Err(e) => {
                    info!(
                        "Custom Java path exists but is not valid: {}. Downloading Java...",
                        e
                    );
                    // Will be set by the download code below
                    std::path::PathBuf::new()
                }
            }
        } else {
            info!(
                "Custom Java path does not exist: {}. Downloading Java...",
                custom_path
            );
            // Will be set by the download code below
            std::path::PathBuf::new()
        }
    } else {
        // No custom path or not enabled, initialize with empty path
        std::path::PathBuf::new()
    };

    // Download and setup Java if necessary
    let java_path = if custom_java_valid {
        info!("Using verified custom Java path: {:?}", java_path);

        // Update progress to 100% since we're using a custom path
        emit_progress_event(
            &state,
            EventType::InstallingJava,
            profile.id,
            &format!("Using custom Java installation! ({}ms)", step_start.elapsed().as_millis()),
            1.0,
            None,
        )
        .await?;

        java_path
    } else {
        // Download Java since custom path is not valid or not set
        info!("Downloading Java {}...", java_version);
        let java_service = JavaDownloadService::new();
        let downloaded_path = java_service
            .get_or_download_java(
                java_version,
                &JavaDistribution::Zulu,
                Some(&piston_meta.java_version.component),
            )
            .await?;

        info!("Java installation path: {:?}", downloaded_path);

        // Update progress to 100%
        emit_progress_event(
            &state,
            EventType::InstallingJava,
            profile.id,
            &format!("Java {} installation completed! ({}ms)", java_version, step_start.elapsed().as_millis()),
            1.0,
            None,
        )
        .await?;

        downloaded_path
    };

    // Create game directory
    let game_directory = state
        .profile_manager
        .calculate_instance_path_for_profile(&profile)?;
    std::fs::create_dir_all(&game_directory)?;

    // --- NEW: Copy StartUpHelper data FIRST ---
    info!("\nChecking for StartUpHelper data to import...");

    // Load PrimePackDefinition if a pack is selected
    let prime_pack = if let Some(pack_id) = profile.effective_prime_pack_id().await {
        let config = state.prime_pack_manager.get_config().await;
        config.get_resolved_pack_definition(&pack_id).ok()
    } else {
        None
    };

    if let Err(e) = mc_utils::copy_startup_helper_data(&profile, &game_directory, prime_pack.as_ref()).await {
        // We will only log a warning because this is not a critical step for launching the game.
        // The installation can proceed even if this fails.
        warn!("Failed to import StartUpHelper data (non-critical error): {}", e);
    }
    info!("StartUpHelper data import check complete.");
    // --- END NEW ---

    // --- Copy initial data from default Minecraft installation ---
    info!("\nChecking for user data to import...");
    if let Err(e) =
        mc_utils::copy_initial_data_from_default_minecraft(&profile, &game_directory).await
    {
        // We will only log a warning because this is not a critical step for launching the game.
        // The installation can proceed even if this fails.
        warn!("Failed to import user data (non-critical error): {}", e);
    }
    info!("User data import check complete.");

    // Download libraries
    let libraries_service = MinecraftLibrariesDownloadService::new()
        .with_concurrent_downloads(launcher_config.concurrent_downloads);
    if is_online {
        timed_step(&state, EventType::DownloadingLibraries, profile.id, "Downloading libraries", || async {
            libraries_service.download_libraries(&piston_meta.libraries).await
        }).await?;
    } else {
        info!("Offline mode: skipping libraries download.");
    }

    // Extract natives
    let natives_service = MinecraftNativesDownloadService::new();
    let cache_natives = launcher_config.cache_natives_extraction;
    timed_step(&state, EventType::ExtractingNatives, profile.id, "Extracting natives", || async {
        natives_service.extract_natives(&piston_meta.libraries, version_id, cache_natives).await
    }).await?;

    // Download MC assets (handles progress events internally)
    if is_online {
        let assets_service = MinecraftAssetsDownloadService::new()
            .with_concurrent_downloads(launcher_config.concurrent_downloads);
        measure_time!("MC assets download", {
            assets_service
                .download_assets_with_progress(&piston_meta.asset_index, profile.id)
                .await?
        });
    } else {
        info!("Offline mode: skipping MC assets download.");
    }

    // Download PrimeClient assets (handles progress events internally)
    if is_online {
        let prime_assets_service = PrimeClientAssetsDownloadService::new()
            .with_concurrent_downloads(launcher_config.concurrent_downloads);
        measure_time!("NRC assets download", {
            prime_assets_service
                .download_nrc_assets_for_profile(&profile, credentials.as_ref(), is_experimental_mode)
                .await?
        });
    } else {
        info!("Offline mode: skipping NRC assets download.");
    }

    // Download Minecraft client
    if is_online {
        let client_service = MinecraftClientDownloadService::new();
        timed_step(&state, EventType::DownloadingClient, profile.id, "Downloading client", || async {
            client_service.download_client(&piston_meta.downloads.client, &piston_meta.id).await
        }).await?;
    } else {
        let client_path = LAUNCHER_DIRECTORY.meta_dir()
            .join("versions")
            .join(&piston_meta.id)
            .join(format!("{}.jar", piston_meta.id));
        if !client_path.exists() {
            return Err(AppError::Other(format!(
                "Minecraft client file is not downloaded and you are offline. Please connect to the internet.",
            )));
        }
        info!("Offline mode: skipping Minecraft client download.");
    }

    // Create and use Minecraft launcher
    let launcher = MinecraftLauncher::new(
        java_path.clone(),
        game_directory.clone(),
        credentials.clone(),
    );

    info!("\nPreparing launch parameters...");

    // Get memory settings (global for standard profiles, profile-specific for custom)
    let memory_max = if profile.is_standard_version {
        let state = State::get().await?;
        let config = state.config_manager.get_config().await;
        config.global_memory_settings.max
    } else {
        profile.settings.memory.max
    };

    let mut launch_params = MinecraftLaunchParameters::new(profile.id, memory_max)
        .with_old_minecraft_arguments(piston_meta.minecraft_arguments.clone())
        .with_resolution(profile.settings.resolution.clone())
        .with_experimental_mode(is_experimental_mode);

    // Add Quick Play parameters if provided
    if let Some(world_name) = quick_play_singleplayer {
        launch_params = launch_params.with_quick_play_singleplayer(world_name);
    } else if let Some(server_address) = quick_play_multiplayer {
        launch_params = launch_params.with_quick_play_multiplayer(server_address);
    }

    // Install modloader using the factory
    if modloader_enum != ModLoader::Vanilla {
        // Resolve loader version using the new modloader factory method
        let mut install_profile = profile.clone();
        let config_now: PrimeModpacksConfig = state.prime_pack_manager.get_config().await;
        let resolved_loader = crate::minecraft::modloader::ModloaderFactory::resolve_loader_version(
            &profile,
            version_id,
            Some(&config_now),
        ).await;

        if let Some(version) = resolved_loader.version {
            let reason_str = match resolved_loader.reason {
                crate::minecraft::modloader::LoaderVersionReason::PrimePack => "Prime pack policy",
                crate::minecraft::modloader::LoaderVersionReason::UserOverwrite => "user overwrite",
                crate::minecraft::modloader::LoaderVersionReason::ProfileDefault => "profile default",
                crate::minecraft::modloader::LoaderVersionReason::NotResolved => "not resolved",
            };
            
            info!(
                "Applying loader version '{}' from {} for MC {} ({:?})",
                version,
                reason_str,
                version_id,
                modloader_enum
            );
            install_profile.loader_version = Some(version);
        }

        let modloader_installer = ModloaderFactory::create_installer_with_config(
            &modloader_enum,
            java_path.clone(),
            launcher_config.concurrent_downloads,
        );
        let modloader_result = measure_time!("Modloader installation", {
            modloader_installer.install(version_id, &install_profile).await?
        });

        // Apply modloader specific parameters to launch parameters
        if let Some(main_class) = modloader_result.main_class {
            launch_params = launch_params.with_main_class(&main_class);
        } else {
            launch_params = launch_params.with_main_class(&piston_meta.main_class);
        }

        if !modloader_result.libraries.is_empty() {
            launch_params = launch_params.with_additional_libraries(modloader_result.libraries);
        }

        if let Some(jvm_args) = modloader_result.jvm_args {
            launch_params = launch_params.with_additional_jvm_args(jvm_args);
        }

        if let Some(game_args) = modloader_result.game_args {
            launch_params = launch_params.with_additional_game_args(game_args);
        }

        if let Some(minecraft_arguments) = modloader_result.minecraft_arguments {
            launch_params = launch_params.with_old_minecraft_arguments(Some(minecraft_arguments));
        }

        if let Some(custom_client_path) = modloader_result.custom_client_path {
            launch_params = launch_params.with_custom_client_jar(custom_client_path);
        }

        if modloader_result.force_include_minecraft_jar {
            launch_params = launch_params.with_force_include_minecraft_jar(true);
        }
    } else {
        // Vanilla main class
        launch_params = launch_params.with_main_class(&piston_meta.main_class);
    }

    // Add custom JVM arguments (global for standard profiles, profile-specific for custom)
    let custom_jvm_args_str = if profile.is_standard_version {
        let state = State::get().await?;
        let config = state.config_manager.get_config().await;
        config.global_custom_jvm_args.clone()
    } else {
        profile.settings.custom_jvm_args.clone()
    };

    if let Some(jvm_args_str) = custom_jvm_args_str {
        if !jvm_args_str.trim().is_empty() {
            let mut current_jvm_args = launch_params.additional_jvm_args.clone();
            let custom_args: Vec<String> =
                jvm_args_str.split_whitespace().map(String::from).collect();
            info!(
                "Adding custom JVM arguments from {}: {:?}",
                if profile.is_standard_version { "global settings" } else { "profile" },
                custom_args
            );
            current_jvm_args.extend(custom_args);
            launch_params = launch_params.with_additional_jvm_args(current_jvm_args);
        }
    }

    // Combine Game arguments from modloader (if any) and profile settings (extra_game_args)
    let mut final_game_args = launch_params.additional_game_args.clone();
    final_game_args.extend(profile.settings.extra_game_args.clone());
    launch_params = launch_params.with_additional_game_args(final_game_args);

    // --- Fetch Prime Config Once if a pack is selected ---
    let loaded_prime_config: Option<PrimeModpacksConfig> = if let Some(pack_id) =
        &profile.selected_prime_pack_id
    {
        info!(
            "Fetching Prime config because pack '{}' is selected. Attempting to refresh first.",
            pack_id
        );
        if let Some(creds) = credentials.as_ref() {
            match creds
                .prime_credentials
                .get_token_for_mode(is_experimental_mode)
            {
                Ok(prime_token_value) => {
                    info!("Attempting to update Prime pack configuration using obtained token for pack '{}'...", pack_id);
                    if let Err(update_err) = state
                        .prime_pack_manager
                        .fetch_and_update_config(&prime_token_value, is_experimental_mode)
                        .await
                    {
                        warn!(
                                "Failed to update Prime pack '{}' configuration: {}. Will proceed with cached version.",
                                pack_id, update_err
                            );
                    } else {
                        info!(
                            "Successfully updated Prime pack '{}' configuration from API.",
                            pack_id
                        );
                    }
                }
                Err(token_err) => {
                    warn!(
                            "Could not obtain Prime token for pack '{}' to update configuration: {}. Will proceed with cached version.",
                            pack_id, token_err
                        );
                }
            }
        } else {
            error!(
                    "A Prime pack ('{}') is selected, but no credentials were provided. Cannot attempt to update pack configuration.",
                    pack_id
                );
        }
        // No need to clone state here, it's still valid in this scope
        // Always attempt to get the config, which will be the latest if updated, or cached otherwise.
        Some(state.prime_pack_manager.get_config().await)
    } else {
        None
    };

    // Helper closures to detect existing mods across all sources and avoid duplicate downloads
    let is_customskinloader_mod = |m: &crate::state::profile_state::Mod| -> bool {
        let check_str = |s: &str| {
            let lower = s.to_lowercase();
            lower.contains("customskinloader") || lower.contains("custom-skin-loader") || lower == "idmhq4n2"
        };
        match &m.source {
            crate::state::profile_state::ModSource::Modrinth { project_id, file_name, .. } => {
                check_str(project_id) || check_str(file_name)
            }
            crate::state::profile_state::ModSource::CurseForge { project_id, file_name, .. } => {
                check_str(project_id) || check_str(file_name)
            }
            crate::state::profile_state::ModSource::Local { file_name } => {
                check_str(file_name)
            }
            crate::state::profile_state::ModSource::Url { file_name, url } => {
                file_name.as_ref().map(|f| check_str(f)).unwrap_or(false) || check_str(url)
            }
            crate::state::profile_state::ModSource::Maven { coordinates, .. } => {
                check_str(coordinates)
            }
            crate::state::profile_state::ModSource::Embedded { name } => {
                check_str(name)
            }
        }
    };

    let is_fabric_api_mod = |m: &crate::state::profile_state::Mod| -> bool {
        let check_str = |s: &str| {
            let lower = s.to_lowercase();
            lower.contains("fabric-api") || lower.contains("fabric_api") || lower == "p7ck78w7"
        };
        match &m.source {
            crate::state::profile_state::ModSource::Modrinth { project_id, file_name, .. } => {
                check_str(project_id) || check_str(file_name)
            }
            crate::state::profile_state::ModSource::CurseForge { project_id, file_name, .. } => {
                check_str(project_id) || check_str(file_name)
            }
            crate::state::profile_state::ModSource::Local { file_name } => {
                check_str(file_name)
            }
            crate::state::profile_state::ModSource::Url { file_name, url } => {
                file_name.as_ref().map(|f| check_str(f)).unwrap_or(false) || check_str(url)
            }
            crate::state::profile_state::ModSource::Maven { coordinates, .. } => {
                check_str(coordinates)
            }
            crate::state::profile_state::ModSource::Embedded { name } => {
                check_str(name)
            }
        }
    };

    let is_sodium_mod = |m: &crate::state::profile_state::Mod| -> bool {
        let check_str = |s: &str| {
            let lower = s.to_lowercase();
            lower.contains("sodium") || lower == "aanobbmi"
        };
        match &m.source {
            crate::state::profile_state::ModSource::Modrinth { project_id, file_name, .. } => {
                check_str(project_id) || check_str(file_name)
            }
            crate::state::profile_state::ModSource::CurseForge { project_id, file_name, .. } => {
                check_str(project_id) || check_str(file_name)
            }
            crate::state::profile_state::ModSource::Local { file_name } => {
                check_str(file_name)
            }
            crate::state::profile_state::ModSource::Url { file_name, url } => {
                file_name.as_ref().map(|f| check_str(f)).unwrap_or(false) || check_str(url)
            }
            crate::state::profile_state::ModSource::Maven { coordinates, .. } => {
                check_str(coordinates)
            }
            crate::state::profile_state::ModSource::Embedded { name } => {
                check_str(name)
            }
        }
    };

    let is_lithium_mod = |m: &crate::state::profile_state::Mod| -> bool {
        let check_str = |s: &str| {
            let lower = s.to_lowercase();
            lower.contains("lithium") || lower == "aunvjelz"
        };
        match &m.source {
            crate::state::profile_state::ModSource::Modrinth { project_id, file_name, .. } => {
                check_str(project_id) || check_str(file_name)
            }
            crate::state::profile_state::ModSource::CurseForge { project_id, file_name, .. } => {
                check_str(project_id) || check_str(file_name)
            }
            crate::state::profile_state::ModSource::Local { file_name } => {
                check_str(file_name)
            }
            crate::state::profile_state::ModSource::Url { file_name, url } => {
                file_name.as_ref().map(|f| check_str(f)).unwrap_or(false) || check_str(url)
            }
            crate::state::profile_state::ModSource::Maven { coordinates, .. } => {
                check_str(coordinates)
            }
            crate::state::profile_state::ModSource::Embedded { name } => {
                check_str(name)
            }
        }
    };

    let is_sodium_extra_mod = |m: &crate::state::profile_state::Mod| -> bool {
        let check_str = |s: &str| {
            let lower = s.to_lowercase();
            lower.contains("sodium-extra") || lower.contains("sodiumextra") || lower.contains("sodium_extra") || lower == "pobwkkp4"
        };
        match &m.source {
            crate::state::profile_state::ModSource::Modrinth { project_id, file_name, .. } => {
                check_str(project_id) || check_str(file_name)
            }
            crate::state::profile_state::ModSource::CurseForge { project_id, file_name, .. } => {
                check_str(project_id) || check_str(file_name)
            }
            crate::state::profile_state::ModSource::Local { file_name } => {
                check_str(file_name)
            }
            crate::state::profile_state::ModSource::Url { file_name, url } => {
                file_name.as_ref().map(|f| check_str(f)).unwrap_or(false) || check_str(url)
            }
            crate::state::profile_state::ModSource::Maven { coordinates, .. } => {
                check_str(coordinates)
            }
            crate::state::profile_state::ModSource::Embedded { name } => {
                check_str(name)
            }
        }
    };

    // --- Step: Check and automatically download/inject CustomSkinLoader if needed ---
    if is_online && modloader_enum != ModLoader::Vanilla {
        let has_customskinloader = profile.mods.iter().any(is_customskinloader_mod);

        if !has_customskinloader {
            info!("CustomSkinLoader mod not found in profile mods. Fetching compatible version from Modrinth...");
            let loaders = Some(vec![modloader_enum.as_str().to_lowercase()]);
            let game_versions = Some(vec![version_id.to_string()]);
            match crate::integrations::modrinth::get_mod_versions(
                "idMHQ4n2".to_string(), // Correct Modrinth project ID for CustomSkinLoader
                loaders,
                game_versions,
            )
            .await
            {
                Ok(versions) => {
                    let compatible_version = versions
                        .iter()
                        .filter(|v| v.version_type == crate::integrations::modrinth::ModrinthVersionType::Release)
                        .max_by_key(|v| &v.date_published)
                        .or_else(|| versions.iter().max_by_key(|v| &v.date_published));

                    if let Some(best_version) = compatible_version {
                        if let Some(primary_file) = best_version.files.iter().find(|f| f.primary).or_else(|| best_version.files.first()) {
                            info!("Found compatible CustomSkinLoader version: {} ({})", best_version.version_number, primary_file.filename);
                            match state.profile_manager.add_modrinth_mod(
                                profile.id,
                                best_version.project_id.clone(),
                                best_version.id.clone(),
                                primary_file.filename.clone(),
                                primary_file.url.clone(),
                                primary_file.hashes.sha1.clone(),
                                Some("CustomSkinLoader".to_string()),
                                Some(best_version.version_number.clone()),
                                Some(best_version.loaders.clone()),
                                Some(best_version.game_versions.clone()),
                                true, // add dependencies
                            )
                            .await
                            {
                                Ok(_) => {
                                    info!("Successfully added CustomSkinLoader to profile {}", profile.id);
                                    if let Ok(updated_profile) = state.profile_manager.get_profile(profile.id).await {
                                        profile = updated_profile;
                                    }
                                }
                                Err(e) => {
                                    warn!("Failed to add CustomSkinLoader to profile: {}", e);
                                }
                            }
                        } else {
                            warn!("No files found for CustomSkinLoader version {}", best_version.id);
                        }
                    } else {
                        warn!("No compatible CustomSkinLoader version found on Modrinth for MC {} / loader {}", version_id, modloader_enum.as_str());
                    }
                }
                Err(e) => {
                    warn!("Failed to fetch CustomSkinLoader versions from Modrinth: {}", e);
                }
            }
        }
    }

    // --- Step: Check and automatically download/inject Fabric API if Fabric loader is used ---
    if is_online && modloader_enum == ModLoader::Fabric {
        let has_fabric_api = profile.mods.iter().any(is_fabric_api_mod);

        if !has_fabric_api {
            info!("Fabric API mod not found in profile mods. Fetching compatible version from Modrinth...");
            let loaders = Some(vec!["fabric".to_string()]);
            let game_versions = Some(vec![version_id.to_string()]);
            match crate::integrations::modrinth::get_mod_versions(
                "P7cK78w7".to_string(),
                loaders,
                game_versions,
            )
            .await
            {
                Ok(versions) => {
                    let compatible_version = versions
                        .iter()
                        .filter(|v| v.version_type == crate::integrations::modrinth::ModrinthVersionType::Release)
                        .max_by_key(|v| &v.date_published)
                        .or_else(|| versions.iter().max_by_key(|v| &v.date_published));

                    if let Some(best_version) = compatible_version {
                        if let Some(primary_file) = best_version.files.iter().find(|f| f.primary).or_else(|| best_version.files.first()) {
                            info!("Found compatible Fabric API version: {} ({})", best_version.version_number, primary_file.filename);
                            match state.profile_manager.add_modrinth_mod(
                                profile.id,
                                best_version.project_id.clone(),
                                best_version.id.clone(),
                                primary_file.filename.clone(),
                                primary_file.url.clone(),
                                primary_file.hashes.sha1.clone(),
                                Some("Fabric API".to_string()),
                                Some(best_version.version_number.clone()),
                                Some(best_version.loaders.clone()),
                                Some(best_version.game_versions.clone()),
                                true, // add dependencies
                            )
                            .await
                            {
                                Ok(_) => {
                                    info!("Successfully added Fabric API to profile {}", profile.id);
                                    if let Ok(updated_profile) = state.profile_manager.get_profile(profile.id).await {
                                        profile = updated_profile;
                                    }
                                }
                                Err(e) => {
                                    warn!("Failed to add Fabric API to profile: {}", e);
                                }
                            }
                        } else {
                            warn!("No files found for Fabric API version {}", best_version.id);
                        }
                    } else {
                        warn!("No compatible Fabric API version found on Modrinth for MC {}", version_id);
                    }
                }
                Err(e) => {
                    warn!("Failed to fetch Fabric API versions from Modrinth: {}", e);
                }
            }
        }
        
        // --- Step: Check and automatically download/inject Sodium if Fabric loader is used ---
        let has_sodium = profile.mods.iter().any(is_sodium_mod);
        if !has_sodium {
            info!("Sodium mod not found in profile mods. Fetching compatible version from Modrinth...");
            let loaders = Some(vec!["fabric".to_string()]);
            let game_versions = Some(vec![version_id.to_string()]);
            match crate::integrations::modrinth::get_mod_versions(
                "AANobbMI".to_string(),
                loaders,
                game_versions,
            )
            .await
            {
                Ok(versions) => {
                    let compatible_version = versions
                        .iter()
                        .filter(|v| v.version_type == crate::integrations::modrinth::ModrinthVersionType::Release)
                        .max_by_key(|v| &v.date_published)
                        .or_else(|| versions.iter().max_by_key(|v| &v.date_published));

                    if let Some(best_version) = compatible_version {
                        if let Some(primary_file) = best_version.files.iter().find(|f| f.primary).or_else(|| best_version.files.first()) {
                            info!("Found compatible Sodium version: {} ({})", best_version.version_number, primary_file.filename);
                            match state.profile_manager.add_modrinth_mod(
                                profile.id,
                                best_version.project_id.clone(),
                                best_version.id.clone(),
                                primary_file.filename.clone(),
                                primary_file.url.clone(),
                                primary_file.hashes.sha1.clone(),
                                Some("Sodium".to_string()),
                                Some(best_version.version_number.clone()),
                                Some(best_version.loaders.clone()),
                                Some(best_version.game_versions.clone()),
                                true, // add dependencies
                            )
                            .await
                            {
                                Ok(_) => {
                                    info!("Successfully added Sodium to profile {}", profile.id);
                                    if let Ok(updated_profile) = state.profile_manager.get_profile(profile.id).await {
                                        profile = updated_profile;
                                    }
                                }
                                Err(e) => {
                                    warn!("Failed to add Sodium to profile: {}", e);
                                }
                            }
                        } else {
                            warn!("No files found for Sodium version {}", best_version.id);
                        }
                    } else {
                        warn!("No compatible Sodium version found on Modrinth for MC {}", version_id);
                    }
                }
                Err(e) => {
                    warn!("Failed to fetch Sodium versions from Modrinth: {}", e);
                }
            }
        }

        // --- Step: Check and automatically download/inject Lithium if Fabric loader is used ---
        let has_lithium = profile.mods.iter().any(is_lithium_mod);
        if !has_lithium {
            info!("Lithium mod not found in profile mods. Fetching compatible version from Modrinth...");
            let loaders = Some(vec!["fabric".to_string()]);
            let game_versions = Some(vec![version_id.to_string()]);
            match crate::integrations::modrinth::get_mod_versions(
                "AUNvJELz".to_string(),
                loaders,
                game_versions,
            )
            .await
            {
                Ok(versions) => {
                    let compatible_version = versions
                        .iter()
                        .filter(|v| v.version_type == crate::integrations::modrinth::ModrinthVersionType::Release)
                        .max_by_key(|v| &v.date_published)
                        .or_else(|| versions.iter().max_by_key(|v| &v.date_published));

                    if let Some(best_version) = compatible_version {
                        if let Some(primary_file) = best_version.files.iter().find(|f| f.primary).or_else(|| best_version.files.first()) {
                            info!("Found compatible Lithium version: {} ({})", best_version.version_number, primary_file.filename);
                            match state.profile_manager.add_modrinth_mod(
                                profile.id,
                                best_version.project_id.clone(),
                                best_version.id.clone(),
                                primary_file.filename.clone(),
                                primary_file.url.clone(),
                                primary_file.hashes.sha1.clone(),
                                Some("Lithium".to_string()),
                                Some(best_version.version_number.clone()),
                                Some(best_version.loaders.clone()),
                                Some(best_version.game_versions.clone()),
                                true, // add dependencies
                            )
                            .await
                            {
                                Ok(_) => {
                                    info!("Successfully added Lithium to profile {}", profile.id);
                                    if let Ok(updated_profile) = state.profile_manager.get_profile(profile.id).await {
                                        profile = updated_profile;
                                    }
                                }
                                Err(e) => {
                                    warn!("Failed to add Lithium to profile: {}", e);
                                }
                            }
                        } else {
                            warn!("No files found for Lithium version {}", best_version.id);
                        }
                    } else {
                        warn!("No compatible Lithium version found on Modrinth for MC {}", version_id);
                    }
                }
                Err(e) => {
                    warn!("Failed to fetch Lithium versions from Modrinth: {}", e);
                }
            }
        }

        // --- Step: Check and automatically download/inject Sodium Extra if Fabric loader is used ---
        let has_sodium_extra = profile.mods.iter().any(is_sodium_extra_mod);
        if !has_sodium_extra {
            info!("Sodium Extra mod not found in profile mods. Fetching compatible version from Modrinth...");
            let loaders = Some(vec!["fabric".to_string()]);
            let game_versions = Some(vec![version_id.to_string()]);
            match crate::integrations::modrinth::get_mod_versions(
                "pobwKkP4".to_string(),
                loaders,
                game_versions,
            )
            .await
            {
                Ok(versions) => {
                    let compatible_version = versions
                        .iter()
                        .filter(|v| v.version_type == crate::integrations::modrinth::ModrinthVersionType::Release)
                        .max_by_key(|v| &v.date_published)
                        .or_else(|| versions.iter().max_by_key(|v| &v.date_published));

                    if let Some(best_version) = compatible_version {
                        if let Some(primary_file) = best_version.files.iter().find(|f| f.primary).or_else(|| best_version.files.first()) {
                            info!("Found compatible Sodium Extra version: {} ({})", best_version.version_number, primary_file.filename);
                            match state.profile_manager.add_modrinth_mod(
                                profile.id,
                                best_version.project_id.clone(),
                                best_version.id.clone(),
                                primary_file.filename.clone(),
                                primary_file.url.clone(),
                                primary_file.hashes.sha1.clone(),
                                Some("Sodium Extra".to_string()),
                                Some(best_version.version_number.clone()),
                                Some(best_version.loaders.clone()),
                                Some(best_version.game_versions.clone()),
                                true, // add dependencies
                            )
                            .await
                            {
                                Ok(_) => {
                                    info!("Successfully added Sodium Extra to profile {}", profile.id);
                                    if let Ok(updated_profile) = state.profile_manager.get_profile(profile.id).await {
                                        profile = updated_profile;
                                    }
                                }
                                Err(e) => {
                                    warn!("Failed to add Sodium Extra to profile: {}", e);
                                }
                            }
                        } else {
                            warn!("No files found for Sodium Extra version {}", best_version.id);
                        }
                    } else {
                        warn!("No compatible Sodium Extra version found on Modrinth for MC {}", version_id);
                    }
                }
                Err(e) => {
                    warn!("Failed to fetch Sodium Extra versions from Modrinth: {}", e);
                }
            }
        }
    }

    // --- Step: Ensure profile-defined mods are downloaded/verified in cache ---
    let mod_downloader_service =
        ModDownloadService::with_concurrency(launcher_config.concurrent_downloads);
    if is_online {
        timed_step(&state, EventType::DownloadingMods, profile.id, "Downloading profile mods", || async {
            mod_downloader_service.download_mods_to_cache(&profile).await
        }).await?;
    } else {
        info!("Offline mode: skipping profile mods download to cache.");
    }

    // --- Step: Download mods from selected Prime Pack (if any) ---
    if let Some(selected_pack_id) = profile.effective_prime_pack_id().await {
        if is_online {
            // Use the already loaded config
            if let Some(config) = loaded_prime_config.as_ref() {
                let prime_mods_event_id = emit_progress_event(
                    &state,
                    EventType::DownloadingMods,
                    profile.id,
                    &format!(
                        "Downloading Prime Pack '{}' Mods... (Phase 2)",
                        selected_pack_id
                    ),
                    0.0,
                    None,
                )
                .await?;

                info!(
                    "Downloading mods for selected Prime Pack '{}'...",
                    selected_pack_id
                );

                let prime_downloader_service =
                    PrimePackDownloadService::with_concurrency(launcher_config.concurrent_downloads);
                let loader_str = modloader_enum.as_str();
                let pack_download_start = Instant::now();
                match measure_time!(format!("Prime pack mods download '{}'", selected_pack_id), {
                    prime_downloader_service
                        .download_pack_mods_to_cache(
                            config,
                            &selected_pack_id,
                            version_id,
                            loader_str,
                        )
                        .await
                })
                {
                    Ok(_) => {
                        info!(
                            "Prime Pack '{}' mods download completed successfully.",
                            selected_pack_id
                        );
                        emit_progress_event(
                            &state,
                            EventType::DownloadingMods,
                            profile.id,
                            &format!(
                                "Prime Pack '{}' Mods downloaded successfully! (Phase 2) ({}ms)",
                                selected_pack_id, pack_download_start.elapsed().as_millis()
                            ),
                            1.0,
                            None,
                        )
                        .await?;
                    }
                    Err(e) => {
                        error!(
                            "Failed to download Prime Pack '{}' mods: {}",
                            selected_pack_id, e
                        );
                        emit_progress_event(
                            &state,
                            EventType::DownloadingMods,
                            profile.id,
                            &format!("Error downloading Prime Pack '{}' mods!", selected_pack_id),
                            1.0,
                            Some(e.to_string()),
                        )
                        .await?;
                    }
                }
            } else {
                // Should not happen if selected_pack_id is Some, but handle defensively
                error!(
                    "Prime config was expected but not loaded for pack ID: {}",
                    selected_pack_id
                );
            }
        } else {
            info!("Offline mode: skipping Prime Pack '{}' mods download.", selected_pack_id);
        }
    } else {
        info!(
            "No Prime Pack selected for profile '{}', skipping pack download.",
            profile.name
        );
    }

    // --- Step: Resolve final mod list for syncing ---
    let resolve_event_id = emit_progress_event(
        &state,
        EventType::SyncingMods,
        profile.id,
        "Resolving final mod list...",
        0.0,
        None,
    )
    .await?;

    let mod_cache_dir = LAUNCHER_DIRECTORY.meta_dir().join("mod_cache");

    // ---> NEW: Get custom mods for this profile <---
    info!("Listing custom mods for profile '{}'...", profile.name);
    let mut custom_mod_infos = state.profile_manager.list_custom_mods(&profile).await?;
    info!(
        "Found {} custom mods for profile '{}'",
        custom_mod_infos.len(),
        profile.name
    );
    // ---> END NEW <---

    // CLI temp launch: extra local mod jars referenced in place (not copied).
    // Fed through the custom-mod path so the resolver writes their absolute path
    // into the addMods meta file. Fabric + Forge/NeoForge only (vanilla has no
    // meta file).
    for path in &extra_local_mods {
        match path.file_name() {
            Some(name) => {
                info!("[Local Mods] Adding CLI local mod in-place: {}", path.display());
                custom_mod_infos.push(crate::state::profile_state::CustomModInfo {
                    filename: name.to_string_lossy().into_owned(),
                    is_enabled: true,
                    path: path.clone(),
                });
            }
            None => warn!(
                "[Local Mods] Skipping --mods path without filename: {}",
                path.display()
            ),
        }
    }

    // Call the resolver function using the already loaded config (or None)
    let resolve_start = Instant::now();
    let target_mods = measure_time!("Mod resolving", {
        crate::minecraft::downloads::mod_resolver::resolve_target_mods(
            &profile,
            loaded_prime_config.as_ref(),
            Some(&custom_mod_infos),
            version_id,
            modloader_enum.as_str(),
            &mod_cache_dir,
        )
        .await?
    });

    emit_progress_event(
        &state,
        EventType::SyncingMods,
        profile.id,
        &format!("Resolved {} mods for sync. ({}ms)", target_mods.len(), resolve_start.elapsed().as_millis()),
        1.0,
        None,
    )
    .await?;

    // --- Provide managed mods via meta file (Fabric: addMods, Forge: NrcCoreMod) ---
    if modloader_enum == ModLoader::Fabric {
        let add_mods_arg = crate::minecraft::downloads::mod_resolver::build_fabric_add_mods_arg(
            profile.id,
            version_id,
            &target_mods,
        )
        .await?;
        let mut current_jvm_args = launch_params.additional_jvm_args.clone();
        current_jvm_args.push(add_mods_arg);
        launch_params = launch_params.with_additional_jvm_args(current_jvm_args);
        info!("Configured Fabric addMods meta file for profile '{}'", profile.name);
    } else if modloader_enum == ModLoader::Forge || modloader_enum == ModLoader::NeoForge {
        let loader_str = if modloader_enum == ModLoader::NeoForge { "neoforge" } else { "forge" };
        let is_legacy_forge = modloader_enum == ModLoader::Forge
            && ["1.7.10", "1.8.9", "1.12.2"].contains(&version_id);

        let (early_service_mods, meta_mods) = if modloader_enum == ModLoader::NeoForge {
            crate::minecraft::downloads::mod_resolver::split_neoforge_early_service_mods(&target_mods).await
        } else {
            (Vec::new(), target_mods.clone())
        };

        let meta_path = crate::minecraft::downloads::mod_resolver::build_forge_add_mods_meta(
            profile.id,
            version_id,
            &meta_mods,
        )
        .await?;

        let forge_libs = crate::minecraft::downloads::forge_libraries_download::ForgeLibrariesDownload::new();
        let loader_path = forge_libs.resolve_forgeloader(version_id, loader_str).await?;

        let mut current_jvm_args = launch_params.additional_jvm_args.clone();
        let meta_path_str = meta_path.to_string_lossy().replace("\\", "/");
        current_jvm_args.push(format!("-Dnrc.addMods=@{}", meta_path_str));

        if is_legacy_forge {
            current_jvm_args.push("-Dfml.coreMods.load=gg.prime.forgeloader.forge.ForgeModLoader".to_string());
        }
        launch_params = launch_params.with_additional_jvm_args(current_jvm_args);

        let mut libs = launch_params.additional_libraries.clone();
        libs.push(loader_path);
        for tm in &early_service_mods {
            libs.push(tm.cache_path.clone());
        }
        launch_params = launch_params.with_additional_libraries(libs);

        info!(
            "Configured {} ForgeModLoader for profile '{}' ({} meta mods, {} early-service mods on cp)",
            loader_str, profile.name, meta_mods.len(), early_service_mods.len()
        );
    }

    // --- Step: Sync mods from cache to profile directory ---
    let profile_mods_path = state.profile_manager.get_profile_mods_path(&profile)?;

    timed_step(&state, EventType::SyncingMods, profile.id, "Syncing mods", || async {
        if modloader_enum == ModLoader::Vanilla {
            info!("Vanilla loader: skipping mod sync — vanilla does not load mods from mods/.");
        } else {
            async_fs::create_dir_all(&profile_mods_path).await?;
            if modloader_enum == ModLoader::Fabric || modloader_enum == ModLoader::Forge || modloader_enum == ModLoader::NeoForge {
                info!("Cleaning managed mods from mods/ folder (all mods loaded via meta file from cache).");
                mod_downloader_service.clean_managed_mods(&target_mods, &profile_mods_path).await?;
            } else {
                mod_downloader_service.sync_mods_to_profile(&target_mods, &profile_mods_path).await?;
            }
        }
        Ok(())
    }).await?;

    // Download log4j configuration if available
    let mut log4j_arg = None;
    if let Some(logging) = &piston_meta.logging {
        let logging_service = MinecraftLoggingDownloadService::new();
        let config_path = measure_time!("Log4j config download", {
            logging_service
                .download_logging_config(&logging.client)
                .await?
        });
        log4j_arg = Some(logging_service.get_jvm_argument(&config_path));
    }

    // Add log4j configuration to JVM arguments if available
    if let Some(log4j_argument) = log4j_arg {
        info!("Adding log4j configuration: {}", log4j_argument);
        let mut jvm_args = launch_params.additional_jvm_args.clone();
        jvm_args.push(log4j_argument);
        launch_params = launch_params.with_additional_jvm_args(jvm_args);
    }

    // --- Execute pre-launch hooks ---
    let launcher_config = state.config_manager.get_config().await;
    if let Some(hook) = &launcher_config.hooks.pre_launch {
        info!("Executing pre-launch hook: {}", hook);
        let hook_event_id = emit_progress_event(
            &state,
            EventType::LaunchingMinecraft,
            profile.id,
            "Executing pre-launch hook...",
            0.0,
            None,
        )
        .await?;

        let mut cmd = hook.split(' ');
        if let Some(command) = cmd.next() {
            let result = std::process::Command::new(command)
                .args(cmd.collect::<Vec<&str>>())
                .current_dir(&game_directory)
                .spawn()
                .map_err(|e| AppError::Io(e))?
                .wait()
                .map_err(|e| AppError::Io(e))?;

            if !result.success() {
                let error_msg = format!(
                    "Pre-launch hook failed with exit code: {}",
                    result.code().unwrap_or(-1)
                );
                error!("{}", error_msg);
                return Err(AppError::Other(error_msg));
            }
        }
        info!("Pre-launch hook executed successfully");
    }

    // --- Setup local CustomSkinLoader files (Skin & Cape) ---
    let username = credentials.as_ref().map(|c| c.username.clone()).unwrap_or_else(|| "Player".to_string());
    let uuid_opt = credentials.as_ref().map(|c| c.id);
    info!("Setting up CustomSkinLoader local textures for player '{}'...", username);

    // Create names/aliases list
    let mut names = vec![username.clone(), username.to_lowercase()];
    if let Some(uuid) = uuid_opt {
        let uuid_dashed = uuid.to_string();
        let uuid_undashed = uuid_dashed.replace("-", "");
        names.push(uuid_dashed.clone());
        names.push(uuid_dashed.to_lowercase());
        names.push(uuid_undashed.clone());
        names.push(uuid_undashed.to_lowercase());
    }
    names.sort();
    names.dedup();

    // Create folders for both standard locations (CustomSkinLoader/ and config/CustomSkinLoader/)
    let csl_dir = game_directory.join("CustomSkinLoader");
    let csl_config_dir = game_directory.join("config").join("CustomSkinLoader");
    
    // Path 1: CustomSkinLoader/LocalSkin/
    let local_skin_dir_1 = csl_dir.join("LocalSkin").join("skins");
    let local_cape_dir_1 = csl_dir.join("LocalSkin").join("capes");
    let _ = std::fs::create_dir_all(&local_skin_dir_1);
    let _ = std::fs::create_dir_all(&local_cape_dir_1);

    // Path 2: LocalSkin/ at the root of game directory
    let local_skin_dir_2 = game_directory.join("LocalSkin").join("skins");
    let local_cape_dir_2 = game_directory.join("LocalSkin").join("capes");
    let _ = std::fs::create_dir_all(&local_skin_dir_2);
    let _ = std::fs::create_dir_all(&local_cape_dir_2);

    // Path 3: config/CustomSkinLoader/LocalSkin/
    let local_skin_dir_3 = csl_config_dir.join("LocalSkin").join("skins");
    let local_cape_dir_3 = csl_config_dir.join("LocalSkin").join("capes");
    let _ = std::fs::create_dir_all(&local_skin_dir_3);
    let _ = std::fs::create_dir_all(&local_cape_dir_3);

    // Write CustomSkinLoader.json configuration to both standard locations
    let csl_config_content = r#"{
  "version": "14.28",
  "buildNumber": 38,
  "enable": true,
  "loadlist": [
    {
      "name": "LocalSkin",
      "type": "Legacy",
      "root": "CustomSkinLoader/LocalSkin/"
    },
    {
      "name": "LocalSkinConfig",
      "type": "Legacy",
      "root": "config/CustomSkinLoader/LocalSkin/"
    },
    {
      "name": "LocalSkinRoot",
      "type": "Legacy",
      "root": "LocalSkin/"
    },
    {
      "name": "Mojang",
      "type": "MojangAPI"
    }
  ]
}"#;

    let csl_config_path_1 = csl_dir.join("CustomSkinLoader.json");
    if let Err(e) = std::fs::write(&csl_config_path_1, csl_config_content) {
        warn!("Failed to write CustomSkinLoader.json to root: {}", e);
    } else {
        info!("Successfully wrote CustomSkinLoader.json to root");
    }

    let _ = std::fs::create_dir_all(&csl_config_dir);
    let csl_config_path_2 = csl_config_dir.join("CustomSkinLoader.json");
    if let Err(e) = std::fs::write(&csl_config_path_2, csl_config_content) {
        warn!("Failed to write CustomSkinLoader.json to config: {}", e);
    } else {
        info!("Successfully wrote CustomSkinLoader.json to config");
    }

    // 1. Skin setup
    if let Some(skin_id) = &launcher_config.selected_skin_id {
        info!("Selected skin ID found in config: {}", skin_id);
        if let Some(skin) = state.skin_manager.get_skin_by_id(skin_id).await {
            match STANDARD.decode(&skin.base64_data) {
                Ok(bytes) => {
                    for name in &names {
                        let skin_path_1 = local_skin_dir_1.join(format!("{}.png", name));
                        let skin_path_2 = local_skin_dir_2.join(format!("{}.png", name));
                        let skin_path_3 = local_skin_dir_3.join(format!("{}.png", name));
                        if let Err(e) = std::fs::write(&skin_path_1, &bytes) {
                            warn!("Failed to write local skin file 1 for {}: {}", name, e);
                        } else {
                            info!("Successfully wrote local skin 1 to {:?}", skin_path_1);
                        }
                        if let Err(e) = std::fs::write(&skin_path_2, &bytes) {
                            warn!("Failed to write local skin file 2 for {}: {}", name, e);
                        } else {
                            info!("Successfully wrote local skin 2 to {:?}", skin_path_2);
                        }
                        if let Err(e) = std::fs::write(&skin_path_3, &bytes) {
                            warn!("Failed to write local skin file 3 for {}: {}", name, e);
                        } else {
                            info!("Successfully wrote local skin 3 to {:?}", skin_path_3);
                        }
                    }
                }
                Err(e) => {
                    warn!("Failed to decode base64 for selected skin: {}", e);
                }
            }
        } else {
            warn!("Selected skin ID {} not found in local database", skin_id);
        }
    } else {
        info!("No selected skin ID in launcher config.");
    }

    // 2. Cape setup
    if let Some(cape_url) = &launcher_config.selected_cape_url {
        info!("Selected cape URL found in config: {}", cape_url);
        
        let bytes_res = if cape_url.starts_with("file:///") {
            let path_str = cape_url.strip_prefix("file:///").unwrap_or(cape_url);
            let path = std::path::PathBuf::from(path_str);
            std::fs::read(&path).map_err(|e| AppError::Io(e))
        } else if cape_url.starts_with("file://") {
            let path_str = cape_url.strip_prefix("file://").unwrap_or(cape_url);
            let path = std::path::PathBuf::from(path_str);
            std::fs::read(&path).map_err(|e| AppError::Io(e))
        } else {
            // Remote URL: download
            let client = &crate::config::HTTP_CLIENT;
            match client.get(cape_url).send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        match resp.bytes().await {
                            Ok(bytes) => Ok(bytes.to_vec()),
                            Err(e) => Err(AppError::RequestError(format!("Failed to read cape download bytes: {}", e))),
                        }
                    } else {
                        Err(AppError::RequestError(format!("Failed to download cape: status {}", resp.status())))
                    }
                }
                Err(e) => Err(AppError::RequestError(format!("Error sending request to download cape: {}", e))),
            }
        };

        match bytes_res {
            Ok(bytes) => {
                for name in &names {
                    let cape_path_1 = local_cape_dir_1.join(format!("{}.png", name));
                    let cape_path_2 = local_cape_dir_2.join(format!("{}.png", name));
                    let cape_path_3 = local_cape_dir_3.join(format!("{}.png", name));
                    if let Err(e) = std::fs::write(&cape_path_1, &bytes) {
                        warn!("Failed to write local cape file 1 for {}: {}", name, e);
                    } else {
                        info!("Successfully wrote local cape 1 to {:?}", cape_path_1);
                    }
                    if let Err(e) = std::fs::write(&cape_path_2, &bytes) {
                        warn!("Failed to write local cape file 2 for {}: {}", name, e);
                    } else {
                        info!("Successfully wrote local cape 2 to {:?}", cape_path_2);
                    }
                    if let Err(e) = std::fs::write(&cape_path_3, &bytes) {
                        warn!("Failed to write local cape file 3 for {}: {}", name, e);
                    } else {
                        info!("Successfully wrote local cape 3 to {:?}", cape_path_3);
                    }
                }
            }
            Err(e) => {
                warn!("Failed to setup cape: {}", e);
            }
        }
    } else {
        info!("No selected cape URL in launcher config.");
    }

    // --- Launch Minecraft ---
    timed_step(&state, EventType::LaunchingMinecraft, profile.id, "Launching Minecraft", || async {
        launcher.launch(&piston_meta, launch_params, Some(profile.clone())).await
    }).await?;

    info!("[Timing] Total installation took {}ms", total_start.elapsed().as_millis());

    Ok(())
}
