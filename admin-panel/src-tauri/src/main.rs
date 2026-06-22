// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use futures::Stream;
use std::pin::Pin;
use std::task::{Context, Poll};
use bytes::Bytes;
use tauri::Emitter;

struct ProgressStream<S> {
    inner: S,
    uploaded: usize,
    total: usize,
    last_percent: usize,
    app_handle: tauri::AppHandle,
}

impl<S> Stream for ProgressStream<S>
where
    S: Stream<Item = Result<Bytes, std::io::Error>> + Unpin,
{
    type Item = Result<Bytes, std::io::Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        match Pin::new(&mut self.inner).poll_next(cx) {
            Poll::Ready(Some(Ok(bytes))) => {
                self.uploaded += bytes.len();
                let percent = (self.uploaded * 100) / self.total.max(1);
                if percent != self.last_percent {
                    self.last_percent = percent;
                    let _ = self.app_handle.emit(
                        "upload_progress",
                        serde_json::json!({
                            "uploaded": self.uploaded,
                            "total": self.total,
                            "percent": percent
                        })
                    );
                }
                Poll::Ready(Some(Ok(bytes)))
            }
            Poll::Ready(other) => Poll::Ready(other),
            Poll::Pending => Poll::Pending,
        }
    }
}

#[derive(serde::Deserialize)]
struct GitHubConfig {
    repo: String,
    token: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct AdminConfig {
    github_repo: Option<String>,
    github_token: Option<String>,
}

#[tauri::command]
async fn load_admin_config() -> Result<AdminConfig, String> {
    let path = std::env::current_dir()
        .map_err(|e| format!("Failed to get current directory: {}", e))?
        .join("admin_config.json");

    if !path.exists() {
        return Ok(AdminConfig {
            github_repo: None,
            github_token: None,
        });
    }

    let data = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    serde_json::from_str(&data).map_err(|e| format!("Failed to parse config JSON: {}", e))
}

#[tauri::command]
async fn save_admin_config(config: AdminConfig) -> Result<(), String> {
    let path = std::env::current_dir()
        .map_err(|e| format!("Failed to get current directory: {}", e))?
        .join("admin_config.json");

    let data = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    tokio::fs::write(&path, data)
        .await
        .map_err(|e| format!("Failed to write config file: {}", e))
}

async fn upload_to_github_release(
    app_handle: &tauri::AppHandle,
    file_path: &str,
    version: &str,
    notes: &str,
    repo: &str,
    token: &str,
) -> Result<String, String> {
    let parts: Vec<&str> = repo.split('/').collect();
    if parts.len() != 2 {
        return Err("GitHub repository must be in 'owner/repo' format.".to_string());
    }
    let owner = parts[0];
    let repo_name = parts[1];

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;

    let tag_name = if version.starts_with('v') {
        version.to_string()
    } else {
        format!("v{}", version)
    };

    println!("Creating GitHub release: {}", tag_name);
    let release_url = format!("https://api.github.com/repos/{}/{}/releases", owner, repo_name);
    
    let release_payload = serde_json::json!({
        "tag_name": tag_name,
        "name": tag_name,
        "body": notes,
        "draft": false,
        "prerelease": false
    });

    let res = client
        .post(&release_url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github.v3+json")
        .json(&release_payload)
        .send()
        .await
        .map_err(|e| format!("Failed to create GitHub release request: {}", e))?;

    let status = res.status();
    let release_json: serde_json::Value = if status.is_success() {
        res.json().await.map_err(|e| format!("Failed to parse GitHub release response: {}", e))?
    } else {
        let err_text = res.text().await.unwrap_or_default();
        if err_text.contains("already_exists") {
            let get_url = format!("https://api.github.com/repos/{}/{}/releases/tags/{}", owner, repo_name, tag_name);
            let get_res = client
                .get(&get_url)
                .header("Authorization", format!("Bearer {}", token))
                .header("Accept", "application/vnd.github.v3+json")
                .send()
                .await
                .map_err(|e| format!("Failed to check existing GitHub release: {}", e))?;
            
            if get_res.status().is_success() {
                get_res.json().await.map_err(|e| format!("Failed to parse existing GitHub release response: {}", e))?
            } else {
                return Err(format!("Release already exists and failed to retrieve it: {}", err_text));
            }
        } else if err_text.contains("Repository is empty") {
            println!("Repository is empty. Initializing repository with README.md...");
            let init_url = format!("https://api.github.com/repos/{}/{}/contents/README.md", owner, repo_name);
            let init_payload = serde_json::json!({
                "message": "Initial commit - Initialize repository for releases",
                "content": "IyBQcmltZSBDbGllbnQgVXBkYXRlcwoKVGhpcyByZXBvc2l0b3J5IGhvbGRzIHRoZSByZWxlYXNlcyBhbmQgdXBkYXRlcyBmb3IgUHJpbWUgQ2xpZW50Lg=="
            });
            
            let init_res = client
                .put(&init_url)
                .header("Authorization", format!("Bearer {}", token))
                .header("Accept", "application/vnd.github.v3+json")
                .json(&init_payload)
                .send()
                .await
                .map_err(|e| format!("Failed to send repository initialization request: {}", e))?;
                
            let init_status = init_res.status();
            if !init_status.is_success() {
                let init_err = init_res.text().await.unwrap_or_default();
                return Err(format!("Failed to initialize empty repository: status {}, error: {}", init_status, init_err));
            }
            
            // Wait a moment for GitHub to process the commit
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            
            // Retry creating the release!
            let retry_res = client
                .post(&release_url)
                .header("Authorization", format!("Bearer {}", token))
                .header("Accept", "application/vnd.github.v3+json")
                .json(&release_payload)
                .send()
                .await
                .map_err(|e| format!("Failed to recreate GitHub release request: {}", e))?;
                
            let retry_status = retry_res.status();
            if retry_status.is_success() {
                retry_res.json().await.map_err(|e| format!("Failed to parse retried GitHub release response: {}", e))?
            } else {
                let retry_err = retry_res.text().await.unwrap_or_default();
                return Err(format!("GitHub release creation failed after initialization with status {}: {}", retry_status, retry_err));
            }
        } else {
            return Err(format!("GitHub release creation failed with status {}: {}", status, err_text));
        }
    };

    let release_id = release_json["id"]
        .as_i64()
        .ok_or_else(|| "GitHub response did not contain release ID".to_string())?;

    let path = std::path::Path::new(file_path);
    let raw_file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("update.exe")
        .to_string();

    let upload_url = format!(
        "https://uploads.github.com/repos/{}/{}/releases/{}/assets?name={}",
        owner, repo_name, release_id, urlencoding::encode(&raw_file_name)
    );

    let mut browser_download_url = String::new();
    let mut upload_success = false;
    let mut attempts = 0;

    while attempts < 3 {
        attempts += 1;
        
        // Delete any existing asset with the same name to avoid 422 "already_exists" error
        let assets_url = format!(
            "https://api.github.com/repos/{}/{}/releases/{}/assets",
            owner, repo_name, release_id
        );
        let assets_res = client
            .get(&assets_url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "application/vnd.github.v3+json")
            .send()
            .await;

        if let Ok(assets_response) = assets_res {
            if assets_response.status().is_success() {
                if let Ok(assets_json) = assets_response.json::<serde_json::Value>().await {
                    if let Some(assets_array) = assets_json.as_array() {
                        for asset in assets_array {
                            let asset_name = asset["name"].as_str().unwrap_or("");
                            if asset_name == raw_file_name {
                                if let Some(asset_id) = asset["id"].as_i64() {
                                    println!("Deleting existing asset '{}' (id: {}) before upload attempt {}...", asset_name, asset_id, attempts);
                                    let delete_url = format!(
                                        "https://api.github.com/repos/{}/{}/releases/assets/{}",
                                        owner, repo_name, asset_id
                                    );
                                    let delete_res = client
                                        .delete(&delete_url)
                                        .header("Authorization", format!("Bearer {}", token))
                                        .header("Accept", "application/vnd.github.v3+json")
                                        .send()
                                        .await;
                                    
                                    if let Ok(del_res) = delete_res {
                                        let del_status = del_res.status();
                                        println!("Deletion status: {}", del_status);
                                    }
                                    
                                    // Sleep to allow GitHub deletion to propagate
                                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                                }
                            }
                        }
                    }
                }
            }
        }

        println!("Uploading asset to GitHub: {} (attempt {})", raw_file_name, attempts);

        let file = tokio::fs::File::open(&path)
            .await
            .map_err(|e| format!("Failed to open file: {}", e))?;
        let metadata = file.metadata().await.map_err(|e| format!("Failed to read file metadata: {}", e))?;
        let total_size = metadata.len() as usize;

        let _ = app_handle.emit(
            "upload_progress",
            serde_json::json!({
                "uploaded": 0,
                "total": total_size,
                "percent": 0
            })
        );

        use futures::StreamExt;
        use tokio_util::codec::{BytesCodec, FramedRead};

        let file_stream = FramedRead::new(file, BytesCodec::new())
            .map(|r| r.map(|bytes| bytes.freeze()));

        let progress_stream = ProgressStream {
            inner: file_stream,
            uploaded: 0,
            total: total_size,
            last_percent: 0,
            app_handle: app_handle.clone(),
        };

        let body = reqwest::Body::wrap_stream(progress_stream);

        let upload_res = client
            .post(&upload_url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Content-Type", "application/octet-stream")
            .header("Content-Length", total_size.to_string())
            .header("Accept", "application/vnd.github.v3+json")
            .body(body)
            .send()
            .await;

        match upload_res {
            Ok(res) => {
                let upload_status = res.status();
                if upload_status.is_success() {
                    let asset_json: serde_json::Value = res
                        .json()
                        .await
                        .map_err(|e| format!("Failed to parse upload asset response: {}", e))?;
                    
                    browser_download_url = asset_json["browser_download_url"]
                        .as_str()
                        .ok_or_else(|| "Response did not contain browser_download_url".to_string())?
                        .to_string();
                    
                    upload_success = true;
                    break;
                } else {
                    let err_text = res.text().await.unwrap_or_default();
                    println!("Upload attempt {} failed with status {}: {}", attempts, upload_status, err_text);
                    if err_text.contains("already_exists") {
                        if attempts < 3 {
                            println!("Asset already exists error encountered. Retrying asset deletion and upload in 3 seconds...");
                            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                            continue;
                        } else {
                            return Err(format!("Asset upload failed with status {}: {}", upload_status, err_text));
                        }
                    } else {
                        return Err(format!("Asset upload failed with status {}: {}", upload_status, err_text));
                    }
                }
            }
            Err(e) => {
                println!("Upload attempt {} request failed: {}", attempts, e);
                if attempts == 3 {
                    return Err(format!("Asset upload request failed: {}", e));
                }
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            }
        }
    }

    if !upload_success {
        return Err("Asset upload failed after 3 attempts due to persistent errors.".to_string());
    }

    Ok(browser_download_url)
}

#[tauri::command]
async fn publish_update(
    app_handle: tauri::AppHandle,
    file_path: Option<String>,
    version: String,
    notes: String,
    existing_url: Option<String>,
    pub_date: String,
    github_config: Option<GitHubConfig>,
) -> Result<String, String> {
    let original_name = if let Some(ref path) = file_path {
        if path.is_empty() {
            existing_url.as_ref().and_then(|url| {
                if url.contains("drive.google.com") || url.contains("docs.google.com") {
                    None
                } else {
                    std::path::Path::new(url)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|s| s.to_string())
                }
            })
        } else {
            std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.to_string())
        }
    } else {
        existing_url.as_ref().and_then(|url| {
            if url.contains("drive.google.com") || url.contains("docs.google.com") {
                None
            } else {
                std::path::Path::new(url)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| s.to_string())
            }
        })
    };

    let final_url = if let Some(path) = file_path {
        if path.is_empty() {
            existing_url.ok_or_else(|| "No installer URL or file selected".to_string())?
        } else {
            // Check if file exists
            if !std::path::Path::new(&path).exists() {
                return Err(format!("Installer file does not exist at: {}", path));
            }

            if let Some(gh) = github_config {
                upload_to_github_release(&app_handle, &path, &version, &notes, &gh.repo, &gh.token).await?
            } else {
                let raw_file_name = std::path::Path::new(&path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("update.exe")
                    .to_string();

                // Change extension to .bin to bypass Catbox.moe's executable block.
                let file_name = if raw_file_name.to_lowercase().ends_with(".exe") {
                    format!("{}.bin", &raw_file_name[..raw_file_name.len() - 4])
                } else {
                    raw_file_name
                };

                // Set up stream for progress upload
                use futures::StreamExt;
                use tokio_util::codec::{BytesCodec, FramedRead};

                let file = tokio::fs::File::open(&path)
                    .await
                    .map_err(|e| format!("Failed to open file: {}", e))?;
                let metadata = file.metadata().await.map_err(|e| format!("Failed to read file metadata: {}", e))?;
                let total_size = metadata.len() as usize;

                // Emit initial progress
                let _ = app_handle.emit(
                    "upload_progress",
                    serde_json::json!({
                        "uploaded": 0,
                        "total": total_size,
                        "percent": 0
                    })
                );

                let file_stream = FramedRead::new(file, BytesCodec::new())
                    .map(|r| r.map(|bytes| bytes.freeze()));

                let progress_stream = ProgressStream {
                    inner: file_stream,
                    uploaded: 0,
                    total: total_size,
                    last_percent: 0,
                    app_handle: app_handle.clone(),
                };

                let body = reqwest::Body::wrap_stream(progress_stream);
                let part = reqwest::multipart::Part::stream(body)
                    .file_name(file_name)
                    .mime_str("application/octet-stream")
                    .map_err(|e| format!("Failed to prepare upload part: {}", e))?;

                let form = reqwest::multipart::Form::new()
                    .text("reqtype", "fileupload")
                    .part("fileToUpload", part);

                // Build a client with custom User-Agent, HTTP/1.1 only, and long timeout
                let client = reqwest::Client::builder()
                    .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                    .http1_only()
                    .timeout(std::time::Duration::from_secs(3600))
                    .build()
                    .map_err(|e| format!("Build client error: {}", e))?;

                let upload_future = client
                    .post("https://catbox.moe/user/api.php")
                    .multipart(form)
                    .send();

                match upload_future.await {
                    Ok(response) => {
                        let status = response.status();
                        if status.is_success() {
                            match response.text().await {
                                Ok(text) => {
                                    let trimmed_url = text.trim().to_string();
                                    if trimmed_url.starts_with("https://") {
                                        trimmed_url
                                    } else {
                                        return Err(format!("Catbox returned error message: {}", trimmed_url));
                                    }
                                }
                                Err(e) => return Err(format!("Read response text error: {}", e)),
                            }
                        } else {
                            return Err(format!("Catbox returned status {}", status));
                        }
                    }
                    Err(e) => return Err(format!("Network error: {}", e)),
                }
            }
        }
    } else {
        existing_url.ok_or_else(|| "No installer URL or file selected".to_string())?
    };

    // Write to Firebase Realtime Database
    #[derive(serde::Serialize)]
    struct FirebaseUpdate {
        version: String,
        notes: String,
        url: String,
        pub_date: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        original_name: Option<String>,
    }

    let update_data = FirebaseUpdate {
        version,
        notes,
        url: final_url.clone(),
        pub_date,
        original_name,
    };

    let client = reqwest::Client::new();
    let response = client
        .put("https://primeclient.is-best.net/update.json")
        .json(&update_data)
        .send()
        .await
        .map_err(|e| format!("Failed to save update data: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Firebase write failed: status {}, response: {}", status, text));
    }
    Ok(final_url)
}

#[tauri::command]
async fn select_installer_file() -> Result<Option<String>, String> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter("Installer Executable (*.exe)", &["exe"])
        .pick_file()
        .await;

    Ok(file.map(|f| f.path().to_string_lossy().to_string()))
}

#[tauri::command]
async fn remove_update() -> Result<(), String> {
    let client = reqwest::Client::new();
    let response = client
        .delete("https://primeclient.is-best.net/update.json")
        .send()
        .await
        .map_err(|e| format!("Failed to send delete request: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Firebase delete failed: status {}, response: {}", status, text));
    }

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            publish_update,
            select_installer_file,
            remove_update,
            load_admin_config,
            save_admin_config
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

