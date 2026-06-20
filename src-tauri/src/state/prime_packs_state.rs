use crate::config::{ProjectDirsExt, LAUNCHER_DIRECTORY};
use crate::error::Result;
use crate::integrations::prime_packs::PrimeModpacksConfig;
use crate::minecraft::api::prime_api::PrimeApi;
use crate::state::post_init::PostInitializationHandler;
use async_trait::async_trait;
use log::{debug, error, info};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs;
use tokio::sync::Mutex;
use tokio::sync::RwLock;

// Default filename for the Prime packs configuration
const PRIME_PACKS_FILENAME: &str = "prime_modpacks.json";

/// Returns the path for the prime packs config depending on experimental mode
pub fn prime_packs_path_for(is_experimental: bool) -> PathBuf {
    let filename = if is_experimental {
        "prime_modpacks_exp.json"
    } else {
        PRIME_PACKS_FILENAME
    };
    LAUNCHER_DIRECTORY.root_dir().join(filename)
}

pub struct PrimePackManager {
    config: Arc<RwLock<PrimeModpacksConfig>>,
    config_path: PathBuf,
    save_lock: Mutex<()>,
}

impl PrimePackManager {
    /// Creates a new PrimePackManager instance, loading the configuration from the specified path.
    /// If the file doesn't exist, it initializes with a default empty configuration.
    pub fn new(config_path: PathBuf) -> Result<Self> {
        info!(
            "PrimePackManager: Initializing with path: {:?} (config loading deferred)",
            config_path
        );
        Ok(Self {
            config: Arc::new(RwLock::new(PrimeModpacksConfig::default())),
            config_path,
            save_lock: Mutex::new(()),
        })
    }

    /// Loads the Prime packs configuration from a JSON file.
    /// Returns a default empty config if the file doesn't exist or cannot be parsed.
    async fn load_config_internal(&self, path: &PathBuf) -> Result<PrimeModpacksConfig> {
        if !path.exists() {
            info!(
                "Prime packs config file not found at {:?}, using default empty config.",
                path
            );
            return Ok(PrimeModpacksConfig {
                packs: HashMap::new(),
                repositories: HashMap::new(),
            });
        }

        let data = fs::read_to_string(path).await?;

        match serde_json::from_str(&data) {
            Ok(config) => Ok(config),
            Err(e) => {
                error!("Failed to parse prime_modpacks.json at {:?}: {}. Returning default empty config.", path, e);
                Ok(PrimeModpacksConfig {
                    packs: HashMap::new(),
                    repositories: HashMap::new(),
                })
            }
        }
    }

    /// Fetches the latest Prime packs configuration from the API and updates the local state.
    /// Saves the updated configuration to the file on success.
    pub async fn fetch_and_update_config(
        &self,
        prime_token: &str,
        is_experimental: bool,
    ) -> Result<()> {
        info!("Fetching latest Prime packs config from API...");

        match PrimeApi::get_modpacks(prime_token, is_experimental).await {
            Ok(new_config) => {
                debug!(
                    "Successfully fetched {} packs definitions from API.",
                    new_config.packs.len()
                );
                {
                    // Scope for the write lock
                    let mut config_guard = self.config.write().await;
                    *config_guard = new_config;
                } // Write lock released here

                // Save the newly fetched config
                match self.save_config().await {
                    Ok(_) => {
                        info!("Successfully updated and saved Prime packs config from API.");
                        Ok(())
                    }
                    Err(e) => {
                        error!("Fetched config from API, but failed to save it: {}", e);
                        Err(e) // Return the save error
                    }
                }
            }
            Err(e) => {
                error!("Failed to fetch Prime packs config from API: {}", e);
                Err(e) // Return the fetch error
            }
        }
    }

    /// Saves the current configuration back to the JSON file.
    async fn save_config(&self) -> Result<()> {
        let _guard = self.save_lock.lock().await;

        let config_data = {
            // Limit the scope of the read lock
            let config_guard = self.config.read().await;
            serde_json::to_string_pretty(&*config_guard)?
        }; // Read lock is released here

        // Choose path based on experimental mode if available; fall back to manager's path
        let path_to_write = if let Ok(state) = crate::state::state_manager::State::get().await {
            let is_exp = state.config_manager.is_experimental_mode().await;
            prime_packs_path_for(is_exp)
        } else {
            self.config_path.clone()
        };

        if let Some(parent_dir) = path_to_write.parent() {
            if !parent_dir.exists() {
                fs::create_dir_all(parent_dir).await?;
                info!(
                    "Created directory for prime packs config: {:?}",
                    parent_dir
                );
            }
        }

        fs::write(&path_to_write, config_data).await?;
        info!(
            "Successfully saved prime packs config to {:?}",
            path_to_write
        );
        Ok(())
    }

    /// Returns a clone of the entire current PrimeModpacksConfig.
    pub async fn get_config(&self) -> PrimeModpacksConfig {
        self.config.read().await.clone()
    }

    /// Updates the entire configuration and saves it to the file.
    pub async fn update_config(&self, new_config: PrimeModpacksConfig) -> Result<()> {
        {
            let mut config_guard = self.config.write().await;
            *config_guard = new_config;
        }
        self.save_config().await // Save the updated config (already handles locking)
    }

    /// Prints the current configuration to the console for debugging.
    #[allow(dead_code)] // Allow unused function for debugging purposes
    pub async fn print_current_config(&self) {
        let config_guard = self.config.read().await;
        println!("--- Current Prime Packs Config ---");
       //println!("{:#?}", *config_guard); // Use pretty-print debug format
       //match config_guard.print_resolved_packs() {
       //    Ok(_) => (),
       //    Err(e) => error!("Failed to print resolved packs: {}", e),
       //}
        println!("--- End Prime Packs Config ---");
    }

    // Add more specific accessor methods if needed, e.g.:
    // pub async fn get_pack_definition(&self, pack_id: &str) -> Option<PrimePackDefinition> { ... }
    // pub async fn get_repository_url(&self, repo_ref: &str) -> Option<String> { ... }
}

#[async_trait]
impl PostInitializationHandler for PrimePackManager {
    async fn on_state_ready(&self, _app_handle: Arc<tauri::AppHandle>) -> Result<()> {
        info!("PrimePackManager: on_state_ready called. Loading configuration...");
        // Select load path based on experimental mode if accessible
        let load_path = if let Ok(state) = crate::state::state_manager::State::get().await {
            let is_exp = state.config_manager.is_experimental_mode().await;
            prime_packs_path_for(is_exp)
        } else {
            self.config_path.clone()
        };

        if !load_path.exists() {
            if let Err(e) = crate::integrations::prime_packs::load_dummy_modpacks().await {
                error!("Failed to copy dummy modpacks: {}", e);
            }
        }

        let loaded_config = self.load_config_internal(&load_path).await?;
        let mut config_guard = self.config.write().await;
        *config_guard = loaded_config;
        drop(config_guard);
        info!("PrimePackManager: Successfully loaded configuration in on_state_ready.");
        Ok(())
    }
}

/// Returns the default path for the prime_modpacks.json file within the launcher directory.
pub fn default_prime_packs_path() -> PathBuf {
    LAUNCHER_DIRECTORY.root_dir().join(PRIME_PACKS_FILENAME)
}
