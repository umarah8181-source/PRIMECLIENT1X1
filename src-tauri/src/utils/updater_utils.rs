use crate::error::{AppError, Result as AppResult};
use log::{error, info, warn};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::time::{sleep, Duration};

/// Checks if the application is running inside a Flatpak environment.
pub fn is_flatpak() -> bool {
    let is_flatpak = std::env::var("FLATPAK_ID").is_ok();
    if is_flatpak {
        info!("Flatpak environment detected (FLATPAK_ID environment variable is set).");
    } else {
        info!("Not running in Flatpak environment (FLATPAK_ID environment variable not found).");
    }
    is_flatpak
}

#[derive(serde::Deserialize, Debug, Clone)]
pub struct FirebaseUpdate {
    pub version: String,
    pub url: String,
    pub notes: Option<String>,
    pub pub_date: Option<String>,
    pub original_name: Option<String>,
}

// Structure to hold available update information
#[derive(Clone, Debug, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
    pub download_url: Option<String>,
    pub original_name: Option<String>,
}

// Define the payload structure for updater status events
#[derive(Clone, Serialize)]
struct UpdaterStatusPayload {
    message: String,
    status: String,
    progress: Option<u64>,
    total: Option<u64>,
    chunk: Option<u64>,
}

// Helper function to emit status updates
pub fn emit_status(
    app_handle: &AppHandle,
    status: &str,
    message: String,
    progress_info: Option<(u64, u64)>,
) {
    let payload = UpdaterStatusPayload {
        message,
        status: status.to_string(),
        progress: progress_info.map(|(chunk, total)| (chunk * 100 / total.max(1))),
        total: progress_info.map(|(_, total)| total),
        chunk: progress_info.map(|(chunk, _)| chunk),
    };
    if let Err(e) = app_handle.emit("updater_status", payload) {
        error!("Failed to emit updater status event: {}", e);
    }
}

fn is_version_newer(current: &str, candidate: &str) -> bool {
    // 1. Try strict semver parsing first
    if let (Ok(curr_v), Ok(cand_v)) = (semver::Version::parse(current), semver::Version::parse(candidate)) {
        return cand_v > curr_v;
    }

    // 2. Fall back to robust dot-separated integer comparison
    let curr_parts: Vec<u64> = current
        .split(|c: char| !c.is_numeric())
        .filter_map(|s| s.parse::<u64>().ok())
        .collect();
        
    let cand_parts: Vec<u64> = candidate
        .split(|c: char| !c.is_numeric())
        .filter_map(|s| s.parse::<u64>().ok())
        .collect();

    if curr_parts.is_empty() || cand_parts.is_empty() {
        // Fallback: simple case-insensitive comparison
        return candidate.to_lowercase() != current.to_lowercase();
    }

    for i in 0..std::cmp::max(curr_parts.len(), cand_parts.len()) {
        let curr_val = curr_parts.get(i).cloned().unwrap_or(0);
        let cand_val = cand_parts.get(i).cloned().unwrap_or(0);
        if cand_val > curr_val {
            return true;
        } else if cand_val < curr_val {
            return false;
        }
    }
    
    false
}

/// Checks if an update is available without downloading or installing it.
pub async fn check_update_available(
    app_handle: &AppHandle,
    _is_beta_channel: bool,
) -> AppResult<Option<UpdateInfo>> {
    let pkg_version = app_handle.package_info().version.to_string();
    info!("Checking for Firebase update... Binary (pkg) version: {}", pkg_version);

    // Check installed_version from config — only used to suppress re-downloads
    let installed_version = match crate::state::state_manager::State::get().await {
        Ok(state) => {
            let config = state.config_manager.get_config().await;
            let inst_v = config.installed_version.clone();
            // If pkg_version has caught up to or exceeded installed_version,
            // the real update was applied — clear the stale marker.
            if let Some(ref iv) = inst_v {
                if !is_version_newer(&pkg_version, iv) {
                    info!("Binary version {} >= installed_version {}; clearing stale marker.", pkg_version, iv);
                    let mut new_config = config.clone();
                    new_config.installed_version = None;
                    let _ = state.config_manager.set_config(new_config).await;
                    None
                } else {
                    info!("installed_version from config: {}", iv);
                    inst_v
                }
            } else {
                None
            }
        }
        Err(_) => None,
    };

    let client = reqwest::Client::new();
    let response = client
        .get("https://prime-client-b9bcd-default-rtdb.asia-southeast1.firebasedatabase.app/update.json")
        .send()
        .await
        .map_err(|e| AppError::Other(format!("Failed to contact Firebase database: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Other(format!("Firebase database returned error status: {}", response.status())));
    }

    let firebase_info: Option<FirebaseUpdate> = response
        .json()
        .await
        .map_err(|e| AppError::Other(format!("Failed to parse Firebase update JSON: {}", e)))?;

    if let Some(info) = firebase_info {
        // The Firebase version must be newer than the actual binary version
        if is_version_newer(&pkg_version, &info.version) {
            // If we already downloaded+installed this exact version before, skip it
            if let Some(ref iv) = installed_version {
                if iv == &info.version {
                    info!("Firebase version {} matches already-installed version — skipping.", info.version);
                    return Ok(None);
                }
            }
            info!("Firebase update available: {} -> {} (Download URL: {})", pkg_version, info.version, info.url);
            return Ok(Some(UpdateInfo {
                version: info.version,
                date: info.pub_date,
                body: info.notes,
                download_url: Some(info.url),
                original_name: info.original_name,
            }));
        } else {
            info!("Firebase version {} is not newer than binary version {}.", info.version, pkg_version);
        }
    }

    info!("No updates available in Firebase.");
    Ok(None)
}

fn hex_to_char(h1: char, h2: char) -> Option<char> {
    let s = format!("{}{}", h1, h2);
    u8::from_str_radix(&s, 16).ok().map(|b| b as char)
}

fn url_decode(s: &str) -> String {
    let mut decoded = String::new();
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let next1 = chars.next();
            let next2 = chars.next();
            if let (Some(h1), Some(h2)) = (next1, next2) {
                if let Some(decoded_char) = hex_to_char(h1, h2) {
                    decoded.push(decoded_char);
                    continue;
                }
                decoded.push('%');
                decoded.push(h1);
                decoded.push(h2);
            } else {
                decoded.push('%');
                if let Some(ch1) = next1 { decoded.push(ch1); }
                if let Some(ch2) = next2 { decoded.push(ch2); }
            }
        } else {
            decoded.push(c);
        }
    }
    decoded
}

/// Helper function to convert a Google Drive share link into a direct download URL.
pub fn convert_gdrive_url(url: &str) -> String {
    if url.contains("drive.google.com") || url.contains("docs.google.com") {
        let mut file_id = None;
        if url.contains("/file/d/") {
            if let Some(start) = url.find("/file/d/") {
                let rest = &url[start + 8..];
                let end = rest.find('/').unwrap_or_else(|| rest.find('?').unwrap_or(rest.len()));
                file_id = Some(rest[..end].to_string());
            }
        } else if url.contains("id=") {
            if let Some(start) = url.find("id=") {
                let rest = &url[start + 3..];
                let end = rest.find('&').unwrap_or(rest.len());
                file_id = Some(rest[..end].to_string());
            }
        }
        if let Some(id) = file_id {
            info!("Converting Google Drive link to direct download. ID: {}", id);
            return format!("https://docs.google.com/uc?export=download&confirm=t&id={}", id);
        }
    }
    url.to_string()
}

/// Downloads and installs an available update, then restarts the application.
pub async fn download_and_install_update(
    app_handle: &AppHandle,
    is_beta_channel: bool,
) -> AppResult<()> {
    info!("Starting Firebase update download and installation...");
    emit_status(
        app_handle,
        "pending",
        "Update found, preparing download...".to_string(),
        None,
    );

    let update_info = check_update_available(app_handle, is_beta_channel)
        .await?
        .ok_or_else(|| AppError::Other("No update available".to_string()))?;

    let raw_download_url = update_info.download_url
        .ok_or_else(|| AppError::Other("No download URL in update info".to_string()))?;
    let download_url = convert_gdrive_url(&raw_download_url);




    let temp_dir = std::env::temp_dir();
    let installer_path = temp_dir.join(format!("prime_client_setup_{}.exe", uuid::Uuid::new_v4()));

    let is_local = download_url.starts_with("file://")
        || download_url.contains(":\\")
        || download_url.starts_with("\\\\");

    if is_local {
        let local_path_str = if download_url.starts_with("file://") {
            let s = download_url.trim_start_matches("file://");
            let trimmed = s.trim_start_matches('/');
            url_decode(trimmed)
        } else {
            download_url.clone()
        };

        let local_path = std::path::PathBuf::from(local_path_str);
        info!("Local update file detected. Copying from {:?} to {:?}", local_path, installer_path);

        emit_status(
            app_handle,
            "downloading",
            "Copying local update file...".to_string(),
            Some((50, 100)),
        );

        tokio::fs::copy(&local_path, &installer_path)
            .await
            .map_err(|e| AppError::Other(format!("Failed to copy local update file from {:?}: {}", local_path, e)))?;

        emit_status(
            app_handle,
            "downloading",
            "Copying complete.".to_string(),
            Some((100, 100)),
        );
    } else {
        let client = reqwest::Client::builder()
            .cookie_store(true)
            .redirect(reqwest::redirect::Policy::limited(10))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .map_err(|e| AppError::Other(format!("Failed to build download client: {}", e)))?;

        // Extract Google Drive ID if it is a Google Drive URL
        let mut gdrive_id = None;
        if download_url.contains("drive.google.com") || download_url.contains("docs.google.com") {
            if download_url.contains("/file/d/") {
                if let Some(start) = download_url.find("/file/d/") {
                    let rest = &download_url[start + 8..];
                    let end = rest.find('/').unwrap_or_else(|| rest.find('?').unwrap_or(rest.len()));
                    gdrive_id = Some(rest[..end].to_string());
                }
            } else if download_url.contains("id=") {
                if let Some(start) = download_url.find("id=") {
                    let rest = &download_url[start + 3..];
                    let end = rest.find('&').unwrap_or(rest.len());
                    gdrive_id = Some(rest[..end].to_string());
                }
            }
        }

        let mut response: reqwest::Response = if let Some(ref id) = gdrive_id {
            info!("[Download] Google Drive link detected. Initiating multi-stage direct download for ID: {}", id);
            let initial_url = format!("https://drive.google.com/uc?export=download&id={}", id);
            let mut res = client
                .get(&initial_url)
                .send()
                .await
                .map_err(|e| AppError::Other(format!("Failed to connect to Google Drive: {}", e)))?;

            let is_html = res.headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.contains("text/html"))
                .unwrap_or(false);

            if is_html {
                info!("[Download] Large file warning page detected from Google Drive. Extracting confirmation token...");
                let html_text = res.text().await
                    .map_err(|e| AppError::Other(format!("Failed to read Google Drive response text: {}", e)))?;

                let mut confirm_token = None;
                if let Some(pos) = html_text.find("confirm=") {
                    let after_confirm = &html_text[pos + 8..];
                    let mut token = String::new();
                    for c in after_confirm.chars() {
                        if c.is_alphanumeric() || c == '_' || c == '-' {
                            token.push(c);
                        } else {
                            break;
                        }
                    }
                    if !token.is_empty() {
                        confirm_token = Some(token);
                    }
                }

                if let Some(token) = confirm_token {
                    info!("[Download] Successfully extracted confirmation token: {}. Fetching direct file stream...", token);
                    let confirm_url = format!("https://drive.google.com/uc?export=download&confirm={}&id={}", token, id);
                    client
                        .get(&confirm_url)
                        .send()
                        .await
                        .map_err(|e| AppError::Other(format!("Failed to download confirmed Google Drive file: {}", e)))?
                } else {
                    return Err(AppError::Other("Failed to find Google Drive confirmation token in response page".to_string()));
                }
            } else {
                info!("[Download] Direct file stream returned immediately (small file).");
                res
            }

        } else {
            client
                .get(&download_url)
                .send()
                .await
                .map_err(|e| AppError::Other(format!("Failed to start download: {}", e)))?
        };

        let total_size = response.content_length();
        let mut downloaded: u64 = 0;

        info!("Downloading update installer to {:?}", installer_path);

        let mut file = tokio::fs::File::create(&installer_path)
            .await
            .map_err(|e| AppError::Other(format!("Failed to create temporary installer file: {}", e)))?;

        use tokio::io::AsyncWriteExt;

        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| AppError::Other(format!("Error during download chunk: {}", e)))?
        {
            file.write_all(&chunk)
                .await
                .map_err(|e| AppError::Other(format!("Failed to write to installer file: {}", e)))?;

            downloaded += chunk.len() as u64;

            if let Some(total) = total_size {
                let progress = (downloaded * 100) / total;
                let msg = format!("Downloading update: {} / {} bytes", downloaded, total);
                emit_status(
                    app_handle,
                    "downloading",
                    msg,
                    Some((downloaded, total)),
                );
            } else {
                let msg = format!("Downloading update: {} bytes", downloaded);
                let payload = UpdaterStatusPayload {
                    message: msg,
                    status: "downloading".to_string(),
                    progress: None,
                    total: None,
                    chunk: Some(downloaded),
                };
                let _ = app_handle.emit("updater_status", payload);
            }
        }

        file.flush()
            .await
            .map_err(|e| AppError::Other(format!("Failed to flush installer file: {}", e)))?;
    }

    info!("Download/Copy complete. Executing update... ");
    emit_status(
        app_handle,
        "installing",
        "Starting installation...".to_string(),
        None,
    );

    // Save the new version as the installed version in configuration
    if let Ok(state) = crate::state::state_manager::State::get().await {
        let mut config = state.config_manager.get_config().await;
        config.installed_version = Some(update_info.version.clone());
        if let Err(e) = state.config_manager.set_config(config).await {
            error!("Failed to save installed_version to config: {}", e);
        } else {
            info!("Successfully saved installed_version: {} to config.", update_info.version);
        }
    }

    let is_installer = is_installer_file(update_info.original_name.as_deref(), &download_url);
    if is_installer {
        info!("Treating update as installer. Running installer interactively...");
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new(&installer_path)
                .spawn()
                .map_err(|e| AppError::Other(format!("Failed to execute installer: {}", e)))?;
        }
        #[cfg(not(target_os = "windows"))]
        {
            warn!("Updater is only implemented for Windows installer files.");
        }
    } else {
        info!("Treating update as raw executable launcher. Performing in-place upgrade...");
        #[cfg(target_os = "windows")]
        {
            let current_exe = std::env::current_exe()
                .map_err(|e| AppError::Other(format!("Failed to get current executable path: {}", e)))?;
            let old_exe = current_exe.with_extension("exe.old");

            // Rename current running executable to .old
            if old_exe.exists() {
                let _ = std::fs::remove_file(&old_exe);
            }
            std::fs::rename(&current_exe, &old_exe)
                .map_err(|e| AppError::Other(format!("Failed to rename running executable: {}", e)))?;

            // Copy the downloaded file to the original executable path
            std::fs::copy(&installer_path, &current_exe)
                .map_err(|e| AppError::Other(format!("Failed to copy new executable to target: {}", e)))?;

            // Spawn the new executable
            std::process::Command::new(&current_exe)
                .spawn()
                .map_err(|e| AppError::Other(format!("Failed to start updated executable: {}", e)))?;
        }
        #[cfg(not(target_os = "windows"))]
        {
            warn!("In-place updater is only implemented for Windows.");
        }
    }

    emit_status(
        app_handle,
        "finished",
        "Update successfully started! Restarting launcher...".to_string(),
        None,
    );

    // Sleep briefly to let the user see the message and the installer to start
    sleep(Duration::from_millis(1500)).await;

    // Exit application so the installer/new executable can proceed
    std::process::exit(0);
}

fn is_installer_file(original_name: Option<&str>, url: &str) -> bool {
    // First check the original_name if available
    if let Some(name) = original_name {
        let name_lower = name.to_lowercase();
        if name_lower.contains("setup") || name_lower.contains("installer") {
            return true;
        }
    }
    // Also check the URL itself (URL-decode it first to handle %20 etc.)
    let url_decoded = urlencoding::decode(url).unwrap_or(std::borrow::Cow::Borrowed(url));
    let url_lower = url_decoded.to_lowercase();
    url_lower.contains("setup") || url_lower.contains("installer") || url_lower.contains("drive.google.com") || url_lower.contains("docs.google.com")
}

/// Creates and configures the dedicated updater window.
pub async fn create_updater_window(app_handle: &AppHandle) -> tauri::Result<WebviewWindow> {
    info!("Creating updater window...");
    let window = WebviewWindowBuilder::new(
        app_handle,
        "updater",
        WebviewUrl::App("updater.html".into()),
    )
    .title("PrimeClient Updater")
    .inner_size(325.0, 400.0)
    .resizable(false)
    .center()
    .decorations(false)
    .skip_taskbar(false)
    .always_on_top(false)
    .visible(false)
    .build()?;

    info!("Updater window created successfully (label: 'updater').");
    Ok(window)
}

/// Check for launcher updates on start.
pub async fn check_for_updates(
    app_handle: AppHandle,
    is_beta_channel: bool,
    updater_window: Option<WebviewWindow>,
) {
    let current_version = app_handle.package_info().version.to_string();
    info!("Checking for updates... Current version: {}", current_version);

    emit_status(
        &app_handle,
        "checking",
        "Checking for updates...".to_string(),
        None,
    );

    match check_update_available(&app_handle, is_beta_channel).await {
        Ok(Some(info)) => {
            info!("Update {} is available!", info.version);

            if let Some(win) = &updater_window {
                let _ = win.show();
            }

            emit_status(
                &app_handle,
                "pending",
                format!("Update {} found!", info.version),
                None,
            );

            match download_and_install_update(&app_handle, is_beta_channel).await {
                Ok(_) => {
                    emit_status(&app_handle, "finished", "Update successful.".to_string(), None);
                }
                Err(e) => {
                    error!("Update failed: {}", e);
                    emit_status(&app_handle, "error", format!("Update failed: {}", e), None);
                }
            }
        }
        Ok(None) => {
            info!("No updates available.");
            emit_status(&app_handle, "uptodate", "Application is up to date.".to_string(), None);
        }
        Err(e) => {
            error!("Error checking for updates: {}", e);
            emit_status(&app_handle, "error", format!("Update check failed: {}", e), None);
        }
    }

    emit_status(&app_handle, "close", "Closing updater.".to_string(), None);
}
