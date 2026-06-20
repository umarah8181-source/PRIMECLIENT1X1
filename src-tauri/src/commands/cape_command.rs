use crate::config::ProjectDirsExt;
use crate::error::{AppError, CommandError};
use crate::minecraft::api::cape_api::{CapeApi, CapeUploadResponse, CapesBrowseResponse, CosmeticCape};
use crate::minecraft::api::mc_api::MinecraftApiService;
use crate::state::state_manager::State;
use log::{debug, error, info};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

// Define a struct to hold all parameters for browse_capes
#[derive(Deserialize, Debug)]
pub struct BrowseCapesPayload {
    page: Option<u32>,
    page_size: Option<u32>,
    sort_by: Option<String>,
    filter_has_elytra: Option<bool>,
    filter_creator: Option<String>,
    time_frame: Option<String>,
    prime_token: Option<String>,
    request_uuid: Option<String>,
}


/// Browse capes with optional parameters
///
/// Parameters are now passed via the BrowseCapesPayload struct
#[tauri::command]
pub async fn browse_capes(
    payload: BrowseCapesPayload,
) -> Result<CapesBrowseResponse, CommandError> {
    debug!("Command called: browse_capes");
    debug!("Payload: {:?}", payload);

    // Get the state manager
    let state = State::get().await?;

    // Get the is_experimental value from the config state
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    // Get the active account
    let active_account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    // Get the Prime token: prioritize passed token, otherwise get from active account
    let token_to_use = match payload.prime_token {
        Some(token) => {
            debug!("Using provided Prime token.");
            token
        }
        None => {
            debug!("No token provided, retrieving from active account.");
            active_account
                .prime_credentials
                .get_token_for_mode(is_experimental)?
        }
    };

    let cape_api = CapeApi::new();

    // Convert filter_creator from String to Uuid if provided
    let filter_creator_uuid = if let Some(creator_str) = payload.filter_creator {
        match Uuid::parse_str(&creator_str) {
            Ok(uuid) => Some(uuid),
            Err(e) => {
                debug!("Invalid UUID format for filter_creator: {}", e);
                return Err(CommandError::from(AppError::InvalidInput(format!(
                    "Invalid UUID format for filter_creator: {}",
                    e
                ))));
            }
        }
    } else {
        None
    };

    // Determine the request UUID to use
    let uuid_to_use = match payload.request_uuid {
        Some(uuid) => {
            debug!("Using provided request UUID: {}", uuid);
            uuid
        }
        None => {
            debug!(
                "No request UUID provided, using active account ID: {}",
                active_account.id
            );
            active_account.id.to_string()
        }
    };

    let result = cape_api
        .browse_capes(
            &token_to_use,
            payload.page,
            payload.page_size,
            payload.sort_by.as_deref(),
            payload.filter_has_elytra,
            filter_creator_uuid.as_ref(),
            payload.time_frame.as_deref(),
            &uuid_to_use,
            is_experimental,
        )
        .await
        .map_err(|e| {
            debug!("Failed to browse capes: {:?}", e);
            CommandError::from(e)
        });

    if result.is_ok() {
        debug!("Command completed: browse_capes");
    } else {
        debug!("Command failed: browse_capes");
    }

    result
}

#[derive(Deserialize, Debug)]
pub struct GetPlayerCapesPayload {
    pub player_identifier: String,
    pub prime_token: Option<String>,
    pub request_uuid: Option<String>,
}

/// Get capes for a specific player
///
/// Parameters:
/// - player_identifier: UUID or username of the player
/// - request_uuid: UUID for tracking the request (optional)
/// - prime_token: Optional Prime token
#[tauri::command]
pub async fn get_player_capes(
    payload: GetPlayerCapesPayload,
) -> Result<Vec<CosmeticCape>, CommandError> {
    debug!(
        "[CMD get_player_capes] Initial payload received: {:?}",
        payload
    );

    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!(
        "[CMD get_player_capes] Using experimental mode: {}",
        is_experimental
    );

    let active_account_opt = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?;

    let player_uuid_to_use: Uuid = match Uuid::parse_str(&payload.player_identifier) {
        Ok(uuid) => {
            debug!(
                "[CMD get_player_capes] Successfully parsed player_identifier as UUID: {}",
                uuid
            );
            uuid
        }
        Err(_) => {
            debug!(
                "[CMD get_player_capes] player_identifier '{}' is not a UUID, attempting to resolve as name.",
                payload.player_identifier
            );
            let api_service = MinecraftApiService::new();
            let profile = api_service
                .get_profile_by_name_or_uuid(&payload.player_identifier)
                .await?;
            match Uuid::parse_str(&profile.id) {
                Ok(resolved_uuid) => {
                    debug!(
                        "[CMD get_player_capes] Resolved player name '{}' to UUID: {}",
                        payload.player_identifier, resolved_uuid
                    );
                    resolved_uuid
                }
                Err(e) => {
                    error!("[CMD get_player_capes] Failed to parse UUID from resolved profile for '{}'. Profile ID: '{}'. Error: {}", payload.player_identifier, profile.id, e);
                    return Err(CommandError::from(AppError::InvalidInput(format!(
                        "Could not resolve player '{}' to a valid UUID.",
                        payload.player_identifier
                    ))));
                }
            }
        }
    };
    debug!(
        "[CMD get_player_capes] Final player_uuid_to_use for API call: {}",
        player_uuid_to_use
    );

    let token_to_use = match payload.prime_token {
        Some(token) => {
            debug!("[CMD get_player_capes] Using prime_token from payload.");
            token
        }
        None => {
            debug!("[CMD get_player_capes] No prime_token in payload, attempting to use token from active account.");
            let acc = active_account_opt.as_ref().ok_or_else(|| {
                error!("[CMD get_player_capes] Prime token required (neither in payload nor from active account).");
                CommandError::from(AppError::NoCredentialsError)
            })?;
            acc.prime_credentials.get_token_for_mode(is_experimental)?
        }
    };
    debug!(
        "[CMD get_player_capes] Token to use (first/last 8 chars): {}...{}",
        &token_to_use[..std::cmp::min(8, token_to_use.len())],
        &token_to_use[std::cmp::max(0, token_to_use.len().saturating_sub(8))..]
    );

    let cape_api = CapeApi::new();

    let uuid_for_request = match payload.request_uuid {
        Some(uuid) => {
            debug!(
                "[CMD get_player_capes] Using request_uuid from payload: {}",
                uuid
            );
            uuid
        }
        None => match active_account_opt.as_ref() {
            Some(acc) => {
                debug!("[CMD get_player_capes] No request_uuid in payload, using active account ID: {}", acc.id);
                acc.id.to_string()
            }
            None => {
                let new_req_uuid = Uuid::new_v4().to_string();
                debug!("[CMD get_player_capes] No request_uuid in payload and no active account, generated new request_uuid: {}", new_req_uuid);
                new_req_uuid
            }
        },
    };
    debug!(
        "[CMD get_player_capes] Request UUID for API call: {}",
        uuid_for_request
    );
    debug!("[CMD get_player_capes] Calling cape_api.get_player_capes with player_uuid: {}, request_uuid: {}, is_experimental: {}",
        player_uuid_to_use, uuid_for_request, is_experimental);

    cape_api
        .get_player_capes(
            &token_to_use,
            &player_uuid_to_use,
            &uuid_for_request,
            is_experimental,
        )
        .await
        .map_err(|e| {
            error!(
                "[CMD get_player_capes] Error from cape_api.get_player_capes: {:?}",
                e
            );
            CommandError::from(e)
        })
}

/// Get owned capes grouped by review state (ACCEPTED, IN_REVIEW, DENIED)
#[tauri::command]
pub async fn get_owned_capes_list(
    page: Option<u32>,
    limit: Option<u32>,
    prime_token: Option<String>,
) -> Result<HashMap<String, Vec<CosmeticCape>>, CommandError> {
    debug!("Command called: get_owned_capes_list");

    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;

    let active_account_res = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await;

    let active_account = match active_account_res {
        Ok(Some(acc)) => Some(acc),
        _ => None,
    };

    let uuid_to_use = active_account.as_ref().map(|acc| acc.id).unwrap_or_else(Uuid::new_v4);

    let token_to_use = match prime_token {
        Some(token) => Some(token),
        None => active_account
            .as_ref()
            .and_then(|acc| acc.prime_credentials.get_token_for_mode(is_experimental).ok()),
    };

    let mut result_map: HashMap<String, Vec<CosmeticCape>> = HashMap::new();

    if let Some(token) = token_to_use {
        let cape_api = CapeApi::new();
        debug!("Attempting to fetch owned capes from server...");
        match cape_api
            .get_owned_capes_list(&token, page, limit, is_experimental)
            .await
        {
            Ok(server_map) => {
                result_map = server_map;
            }
            Err(e) => {
                debug!("Failed to fetch owned capes list from server: {:?}. Using local fallback.", e);
            }
        }
    } else {
        debug!("No Prime token available. Retrieving local capes only.");
    }

    let accepted_list = result_map.entry("ACCEPTED".to_string()).or_insert_with(Vec::new);

    let local_capes_dir = crate::config::LAUNCHER_DIRECTORY.meta_dir().join("local_capes");
    if local_capes_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&local_capes_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().map_or(false, |ext| ext == "png") {
                    if let Some(stem) = path.file_stem() {
                        let hash = stem.to_string_lossy().into_owned();
                        
                        let current_time_millis = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as i64;

                        let cosmetic_cape = CosmeticCape {
                            hash: format!("local_{}", hash),
                            accepted: true,
                            uses: 0,
                            first_seen: uuid_to_use,
                            moderator_message: "Local Cape".to_string(),
                            creation_date: current_time_millis,
                            elytra: true,
                            blur_hash: None,
                            local_path: Some(path.to_string_lossy().into_owned()),
                        };
                        
                        if !accepted_list.iter().any(|c| c.hash == cosmetic_cape.hash) {
                            accepted_list.push(cosmetic_cape);
                        }
                    }
                }
            }
        }
    }

    Ok(result_map)
}

/// Equip a specific cape for a player
#[tauri::command]
pub async fn equip_cape(
    cape_hash: String,
    prime_token: Option<String>,
    player_uuid: Option<Uuid>,
) -> Result<(), CommandError> {
    debug!(
        "Command called: equip_cape for cape_hash: {}, player_uuid: {:?}",
        cape_hash, player_uuid
    );

    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    let active_account_res = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?;

    let active_account = match active_account_res {
        Some(acc) => acc,
        None => {
            return Err(CommandError::from(AppError::NoCredentialsError));
        }
    };

    if cape_hash.starts_with("local_") {
        let hash = cape_hash.trim_start_matches("local_");
        let local_capes_dir = crate::config::LAUNCHER_DIRECTORY.meta_dir().join("local_capes");
        let local_cape_path = local_capes_dir.join(format!("{}.png", hash));
        
        if local_cape_path.exists() {
            let file_url = format!("file:///{}", local_cape_path.to_string_lossy().replace("\\", "/"));
            
            let mut current_config = state.config_manager.get_config().await;
            current_config.selected_cape_url = Some(file_url);
            state.config_manager.set_config(current_config).await?;
            
            info!("Successfully equipped local cape: {}", cape_hash);
            return Ok(());
        } else {
            return Err(CommandError::from(AppError::FileNotFound(local_cape_path)));
        }
    }

    let token_to_use = match prime_token {
        Some(token) => Some(token),
        None => active_account
            .prime_credentials
            .get_token_for_mode(is_experimental)
            .ok(),
    };

    let token = match token_to_use {
        Some(t) => t,
        None => {
            return Err(CommandError::from(AppError::NoCredentialsError));
        }
    };

    let cape_api = CapeApi::new();

    let uuid_to_use = match player_uuid {
        Some(uuid) => uuid,
        None => active_account.id,
    };

    cape_api
        .equip_cape(&token, &uuid_to_use, &cape_hash, is_experimental)
        .await
        .map_err(|e| {
            debug!("Failed to equip cape: {:?}", e);
            CommandError::from(e)
        })?;

    let base_url = if is_experimental {
        "https://cdn.prime.gg/capes-staging/prod"
    } else {
        "https://cdn.prime.gg/capes/prod"
    };
    let final_cape_url = format!("{}/{}.png", base_url, cape_hash);

    let mut current_config = state.config_manager.get_config().await;
    current_config.selected_cape_url = Some(final_cape_url);
    state.config_manager.set_config(current_config).await?;

    info!("Successfully equipped remote cape: {}", cape_hash);

    let mut props = std::collections::HashMap::new();
    props.insert("cape_hash".to_string(), serde_json::Value::String(cape_hash.clone()));
    props.insert("cape_source".to_string(), serde_json::Value::String("custom".to_string()));
    props.insert("cape_name".to_string(), serde_json::Value::String(cape_hash));
    crate::commands::analytics_command::track_event("cape_selected", props);

    Ok(())
}

/// Add a cape to the user's favorites
///
/// Parameters:
/// - cape_hash: Hash of the cape to favorite
/// - prime_token: Optional Prime token
#[tauri::command]
pub async fn add_favorite_cape(
    cape_hash: String,
    prime_token: Option<String>,
) -> Result<Vec<String>, CommandError> {
    debug!(
        "Command called: add_favorite_cape for cape_hash: {}",
        cape_hash
    );

    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    let active_account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    let token_to_use = match prime_token {
        Some(token) => {
            debug!("Using provided Prime token.");
            token
        }
        None => {
            debug!("No token provided, retrieving from active account.");
            active_account
                .prime_credentials
                .get_token_for_mode(is_experimental)?
        }
    };

    let cape_api = CapeApi::new();

    cape_api
        .add_favorite_cape(&token_to_use, &cape_hash, is_experimental)
        .await
        .map_err(|e| {
            debug!("Failed to add favorite cape: {:?}", e);
            CommandError::from(e)
        })
}

/// Get multiple capes by hashes (max 100)
#[tauri::command]
pub async fn get_capes_by_hashes(
    hashes: Vec<String>,
    prime_token: Option<String>,
) -> Result<Vec<CosmeticCape>, CommandError> {
    debug!(
        "Command called: get_capes_by_hashes (count={})",
        hashes.len()
    );

    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    let active_account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    let token_to_use = match prime_token {
        Some(token) => {
            debug!("Using provided Prime token.");
            token
        }
        None => {
            debug!("No token provided, retrieving from active account.");
            active_account
                .prime_credentials
                .get_token_for_mode(is_experimental)?
        }
    };

    let cape_api = CapeApi::new();

    cape_api
        .get_capes_by_hashes(&token_to_use, &hashes, is_experimental)
        .await
        .map_err(|e| {
            debug!("Failed to get capes by hashes: {:?}", e);
            CommandError::from(e)
        })
}

/// Remove a cape from the user's favorites
///
/// Parameters:
/// - cape_hash: Hash of the cape to remove from favorites
/// - prime_token: Optional Prime token
#[tauri::command]
pub async fn remove_favorite_cape(
    cape_hash: String,
    prime_token: Option<String>,
) -> Result<Vec<String>, CommandError> {
    debug!(
        "Command called: remove_favorite_cape for cape_hash: {}",
        cape_hash
    );

    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    let active_account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    let token_to_use = match prime_token {
        Some(token) => {
            debug!("Using provided Prime token.");
            token
        }
        None => {
            debug!("No token provided, retrieving from active account.");
            active_account
                .prime_credentials
                .get_token_for_mode(is_experimental)?
        }
    };

    let cape_api = CapeApi::new();

    cape_api
        .remove_favorite_cape(&token_to_use, &cape_hash, is_experimental)
        .await
        .map_err(|e| {
            debug!("Failed to remove favorite cape: {:?}", e);
            CommandError::from(e)
        })
}

/// Check if the current user is a moderator (team member)
#[tauri::command]
pub async fn check_is_moderator() -> Result<bool, CommandError> {
    debug!("Command called: check_is_moderator");

    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;

    let active_account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    let token = active_account
        .prime_credentials
        .get_token_for_mode(is_experimental)?;

    CapeApi::check_is_moderator(&token, is_experimental)
        .await
        .map_err(|e| {
            debug!("Failed to check moderator status: {:?}", e);
            CommandError::from(e)
        })
}

/// Delete a specific cape owned by the player
///
/// Parameters:
/// - cape_hash: Hash of the cape to delete
/// - prime_token: Optional Prime token
/// - player_uuid: Optional UUID of the player (defaults to active account)
/// - reason: Optional reason for deletion (used by moderators)
#[tauri::command]
pub async fn delete_cape(
    cape_hash: String,
    prime_token: Option<String>,
    player_uuid: Option<Uuid>,
    reason: Option<String>,
) -> Result<(), CommandError> {
    debug!(
        "Command called: delete_cape for cape_hash: {}, player_uuid: {:?}",
        cape_hash, player_uuid
    );

    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    if cape_hash.starts_with("local_") {
        let hash = cape_hash.trim_start_matches("local_");
        let local_capes_dir = crate::config::LAUNCHER_DIRECTORY.meta_dir().join("local_capes");
        let local_cape_path = local_capes_dir.join(format!("{}.png", hash));
        
        if local_cape_path.exists() {
            std::fs::remove_file(&local_cape_path)
                .map_err(|e| CommandError::from(AppError::Io(e)))?;
            
            let mut current_config = state.config_manager.get_config().await;
            if let Some(equipped_url) = &current_config.selected_cape_url {
                if equipped_url.contains(hash) {
                    current_config.selected_cape_url = None;
                    state.config_manager.set_config(current_config).await?;
                }
            }
            
            info!("Successfully deleted local cape: {}", cape_hash);
            return Ok(());
        } else {
            return Err(CommandError::from(AppError::FileNotFound(local_cape_path)));
        }
    }

    let active_account = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await?
        .ok_or_else(|| CommandError::from(AppError::NoCredentialsError))?;

    let token_to_use = match prime_token {
        Some(token) => token,
        None => active_account
            .prime_credentials
            .get_token_for_mode(is_experimental)?
    };

    let cape_api = CapeApi::new();

    let uuid_to_use = match player_uuid {
        Some(uuid) => uuid,
        None => active_account.id,
    };

    cape_api
        .delete_cape(&token_to_use, &uuid_to_use, &cape_hash, reason.as_deref(), is_experimental)
        .await
        .map_err(|e| {
            debug!("Failed to delete cape: {:?}", e);
            CommandError::from(e)
        })?;

    let mut current_config = state.config_manager.get_config().await;
    if let Some(equipped_url) = &current_config.selected_cape_url {
        if equipped_url.contains(&cape_hash) {
            current_config.selected_cape_url = None;
            state.config_manager.set_config(current_config).await?;
        }
    }

    info!("Successfully deleted remote cape: {}", cape_hash);
    Ok(())
}

/// Upload a new cape image for the active player
#[tauri::command]
pub async fn upload_cape(
    image_path: String,
    prime_token: Option<String>,
    player_uuid: Option<Uuid>,
) -> Result<CapeUploadResponse, CommandError> {
    debug!(
        "Command called: upload_cape with image_path: {}, player_uuid: {:?}",
        image_path, player_uuid
    );

    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    let active_account_res = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await;

    let active_account = match active_account_res {
        Ok(Some(acc)) => Some(acc),
        _ => None,
    };

    let uuid_to_use = match player_uuid {
        Some(uuid) => Some(uuid),
        None => active_account.as_ref().map(|acc| acc.id),
    };

    let image_path_buf = PathBuf::from(&image_path);

    let token_to_use = match prime_token {
        Some(token) => Some(token),
        None => active_account
            .as_ref()
            .and_then(|acc| acc.prime_credentials.get_token_for_mode(is_experimental).ok()),
    };

    if let Some(token) = token_to_use {
        if let Some(uuid) = uuid_to_use {
            let cape_api = CapeApi::new();
            debug!("Attempting online cape upload to server...");
            match cape_api
                .upload_cape(
                    &token,
                    &uuid,
                    &image_path_buf,
                    is_experimental,
                )
                .await
            {
                Ok(res) => {
                    debug!("Online cape upload successful");
                    // Automatically equip the uploaded cape online
                    if let Err(e) = cape_api.equip_cape(&token, &uuid, &res.cape_hash, is_experimental).await {
                        log::warn!("Failed to automatically equip uploaded online cape: {:?}", e);
                    } else {
                        info!("Automatically equipped uploaded online cape: {}", res.cape_hash);
                        let base_url = if is_experimental {
                            "https://cdn.prime.gg/capes-staging/prod"
                        } else {
                            "https://cdn.prime.gg/capes/prod"
                        };
                        let final_cape_url = format!("{}/{}.png", base_url, res.cape_hash);
                        let mut current_config = state.config_manager.get_config().await;
                        current_config.selected_cape_url = Some(final_cape_url);
                        if let Err(err) = state.config_manager.set_config(current_config).await {
                            log::warn!("Failed to save config with automatically equipped cape: {:?}", err);
                        }
                    }
                    return Ok(res);
                }
                Err(e) => {
                    debug!("Online cape upload failed: {:?}. Falling back to local cape saving.", e);
                }
            }
        }
    } else {
        debug!("No Prime token available. Falling back to local cape saving.");
    }

    use sha2::{Sha256, Digest};
    let image_data = std::fs::read(&image_path_buf)
        .map_err(|e| CommandError::from(AppError::Io(e)))?;
    let mut hasher = Sha256::new();
    hasher.update(&image_data);
    let hash = format!("{:x}", hasher.finalize());

    let local_capes_dir = crate::config::LAUNCHER_DIRECTORY.meta_dir().join("local_capes");
    std::fs::create_dir_all(&local_capes_dir)
        .map_err(|e| CommandError::from(AppError::Io(e)))?;
    let local_cape_path = local_capes_dir.join(format!("{}.png", hash));
    std::fs::write(&local_cape_path, &image_data)
        .map_err(|e| CommandError::from(AppError::Io(e)))?;

    debug!("Successfully saved cape locally to: {:?}", local_cape_path);

    let cape_hash = format!("local_{}", hash);
    // Automatically equip local cape
    let file_url = format!("file:///{}", local_cape_path.to_string_lossy().replace("\\", "/"));
    let mut current_config = state.config_manager.get_config().await;
    current_config.selected_cape_url = Some(file_url);
    if let Err(err) = state.config_manager.set_config(current_config).await {
        log::warn!("Failed to save config with automatically equipped local cape: {:?}", err);
    }
    info!("Successfully automatically equipped local cape: {}", cape_hash);

    Ok(CapeUploadResponse {
        cape_hash,
    })
}

/// Unequip the currently equipped cape for the active player
///
/// Parameters:
/// - prime_token: Optional Prime token
/// - player_uuid: Optional UUID of the player (defaults to active account)
#[tauri::command]
pub async fn unequip_cape(
    prime_token: Option<String>,
    player_uuid: Option<Uuid>,
) -> Result<(), CommandError> {
    debug!(
        "Command called: unequip_cape for player_uuid: {:?}",
        player_uuid
    );

    // Get the state manager
    let state = State::get().await?;

    // Get the is_experimental value from the config state
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    // Always clear the local selected cape url config first
    let mut current_config = state.config_manager.get_config().await;
    current_config.selected_cape_url = None;
    state.config_manager.set_config(current_config).await?;

    // Get the active account
    let active_account_res = state
        .minecraft_account_manager_v2
        .get_active_account()
        .await;

    let active_account = match active_account_res {
        Ok(Some(acc)) => acc,
        _ => {
            debug!("No active account logged in while unequipping cape. Cleared local config successfully.");
            return Ok(());
        }
    };

    // Get the Prime token: prioritize passed token, otherwise get from active account
    let token_to_use = match prime_token {
        Some(token) => Some(token),
        None => active_account
            .prime_credentials
            .get_token_for_mode(is_experimental)
            .ok(),
    };

    let token = match token_to_use {
        Some(t) => t,
        None => {
            debug!("No Prime credentials/token available while unequipping cape. Cleared local config successfully.");
            return Ok(());
        }
    };

    let cape_api = CapeApi::new();

    // Determine the player UUID to use
    let uuid_to_use = match player_uuid {
        Some(uuid) => uuid,
        None => active_account.id,
    };

    let result = cape_api
        .unequip_cape(&token, &uuid_to_use, is_experimental)
        .await
        .map_err(|e| {
            debug!("Failed to unequip cape on server: {:?}", e);
            CommandError::from(e)
        });

    if result.is_ok() {
        debug!("Command completed: unequip_cape");
    } else {
        debug!("Command failed: unequip_cape");
    }

    result
}

/// Download a cape template and open the explorer to the file
///
/// Downloads the template to the user's download directory and opens the folder
#[tauri::command]
pub async fn download_template_and_open_explorer(
    app_handle: tauri::AppHandle,
    with_elytra: bool,
) -> Result<(), CommandError> {
    debug!("Command called: download_template_and_open_explorer (elytra: {})", with_elytra);

    let state = State::get().await?;
    let is_experimental = state.config_manager.is_experimental_mode().await;
    debug!("Using experimental mode: {}", is_experimental);

    let template_file = if with_elytra { "template.png" } else { "template_no_elytra.png" };
    let template_url = if is_experimental {
        format!("https://cdn.prime.gg/capes-staging/{}", template_file)
    } else {
        format!("https://cdn.prime.gg/capes/{}", template_file)
    };
    debug!("Template URL: {}", template_url);

    // Get user's download directory
    let user_dirs = directories::UserDirs::new().ok_or_else(|| {
        CommandError::from(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Failed to get user directories",
        )))
    })?;

    let downloads_dir = user_dirs.download_dir().ok_or_else(|| {
        CommandError::from(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Failed to get downloads directory",
        )))
    })?;

    debug!("Downloads directory: {:?}", downloads_dir);

    let download_name = if with_elytra { "nrc_cape_template.png" } else { "nrc_cape_template_no_elytra.png" };
    let file_path = downloads_dir.join(download_name);
    let file_path_str = file_path.to_string_lossy().to_string();

    // Download the template using reqwest
    let response = crate::config::HTTP_CLIENT
        .get(template_url)
        .send()
        .await
        .map_err(|e| {
            error!("Error downloading template: {:?}", e);
            CommandError::from(AppError::RequestError(format!(
                "Error downloading template: {}",
                e
            )))
        })?;

    // Read response bytes
    let template_bytes = response.bytes().await.map_err(|e| {
        error!("Error reading template bytes: {:?}", e);
        CommandError::from(AppError::RequestError(format!(
            "Error reading template bytes: {}",
            e
        )))
    })?;

    // Save the template to the file using tokio's async file operations
    tokio::fs::write(&file_path, &template_bytes)
        .await
        .map_err(|e| {
            error!("Error writing template file: {:?}", e);
            CommandError::from(AppError::Io(e))
        })?;

    debug!("Template downloaded to: {:?}", file_path);

    // Use the Tauri opener plugin to reveal the file in the explorer
    app_handle
        .opener()
        .reveal_item_in_dir(file_path_str)
        .map_err(|e| {
            error!("Error revealing file in directory: {:?}", e);
            CommandError::from(AppError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Error revealing file in directory: {}", e),
            )))
        })?;

    debug!("File revealed in directory");
    debug!("Command completed: download_template_and_open_explorer");
    Ok(())
}
