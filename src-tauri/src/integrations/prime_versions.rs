use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::{AppError, Result};
use crate::state::profile_state::Profile;
use crate::state::state_manager::State;
use log::{self, error, info, warn};
use serde::{Deserialize, Serialize};
use std::env;
use std::path::PathBuf;
use tokio::fs;

const PRIME_API_BASE_URL: &str = "https://api.primeclient.com/v1";

/// Helper to compute versions file path based on experimental flag
fn prime_versions_path_for(is_experimental: bool) -> PathBuf {
    let filename = if is_experimental {
        "prime_versions_exp.json"
    } else {
        "prime_versions.json"
    };
    LAUNCHER_DIRECTORY.root_dir().join(filename)
}

/// Represents the overall structure of the standard profiles from the backend
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PrimeVersionsConfig {
    /// A list of standard profiles
    pub profiles: Vec<Profile>,
}

impl Default for PrimeVersionsConfig {
    fn default() -> Self {
        Self { profiles: vec![] }
    }
}

/// Loads standard profiles from the local `prime_versions.json` file.
/// Returns an empty config if the file doesn't exist.
pub async fn load_local_standard_profiles() -> Result<PrimeVersionsConfig> {
    let file_path = if let Ok(state) = State::get().await {
        let is_exp = state.config_manager.is_experimental_mode().await;
        prime_versions_path_for(is_exp)
    } else {
        LAUNCHER_DIRECTORY.root_dir().join("prime_versions.json")
    };

    info!(
        "Attempting to load local standard profiles from: {:?}",
        file_path
    );

    if !file_path.exists() {
        warn!(
            "Local standard profiles file not found at {:?}. Returning empty config.",
            file_path
        );
        return Ok(PrimeVersionsConfig { profiles: vec![] });
    }

    let data = fs::read_to_string(&file_path).await.map_err(|e| {
        error!(
            "Failed to read local standard profiles file {:?}: {}",
            file_path, e
        );
        AppError::Io(e)
    })?;

    let profiles_config: PrimeVersionsConfig = serde_json::from_str(&data).map_err(|e| {
        error!(
            "Failed to parse local standard profiles file {:?}: {}",
            file_path, e
        );
        AppError::ParseError(format!("Failed to parse prime_versions.json: {}", e))
    })?;

    info!(
        "Successfully loaded {} local standard profiles from {:?}",
        profiles_config.profiles.len(),
        file_path
    );
    Ok(profiles_config)
}

/// Copies a dummy/default `prime_versions.json` from the project's source directory
/// (assuming a development environment structure) to the launcher's root directory
/// if it doesn't already exist.
///
/// Note: This path resolution using CARGO_MANIFEST_DIR might not work correctly
/// in a packaged production build. Consider using Tauri's resource resolver for that.
pub async fn load_dummy_versions() -> Result<()> {
    let target_dir = LAUNCHER_DIRECTORY.root_dir();
    // Choose target file based on experimental mode when available
    let target_file = if let Ok(state) = State::get().await {
        let is_exp = state.config_manager.is_experimental_mode().await;
        prime_versions_path_for(is_exp)
    } else {
        target_dir.join("prime_versions.json")
    };

    if target_file.exists() {
        return Ok(());
    }

    // Embed the default versions JSON directly in the binary at compile time
    const DEFAULT_VERSIONS: &str = include_str!("../../../mock-data/primeclient/prime_versions.json");

    // Ensure the target directory exists
    fs::create_dir_all(&target_dir).await.map_err(|e| {
        error!("Failed to create target directory {:?}: {}", target_dir, e);
        AppError::Io(e)
    })?;

    // Write the embedded data
    fs::write(&target_file, DEFAULT_VERSIONS).await.map_err(|e| {
        error!("Failed to write default versions to {:?}: {}", target_file, e);
        AppError::Io(e)
    })?;

    info!("Successfully wrote default versions to {:?}", target_file);
    Ok(())
}
