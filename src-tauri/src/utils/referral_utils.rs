//! Referral tracking utilities for affiliate and friend referral links.
//!
//! Flow:
//! 1. NSIS installer writes referral code to referral_code.txt in install dir
//! 2. On startup, we read the code and save it to config.referral_state
//! 3. After login (when we have a Prime token), we report the code
//! 4. On successful report, we set redeemed=true (code stays for tracing!)

use log::{debug, error, info, warn};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::error::Result;
use crate::minecraft::api::prime_api::PrimeApi;
use crate::state::config_state::ReferralState;
use crate::state::State;

/// Filename for the installer name written by the installer
const INSTALLER_NAME_FILENAME: &str = "installer_name.txt";

/// Extracts the referral code from the installer filename.
/// Expected filename format: PrimeClient-Windows-setup-REFERRALCODE.exe
/// Look for the text between "-setup-" and ".exe".
fn extract_referral_code(filename: &str) -> Option<String> {
    if let Some(setup_idx) = filename.find("-setup-") {
        let start_idx = setup_idx + "-setup-".len();
        if let Some(exe_idx) = filename[start_idx..].find(".exe") {
            let code = filename[start_idx..start_idx + exe_idx].trim().to_string();
            if !code.is_empty() {
                return Some(code);
            }
        }
    }
    None
}

/// Check for referral code in the installer name and save to config.
/// This should be called during launcher startup.
/// Does NOT send to backend - that happens after login with token.
pub async fn check_and_process_referral_code() -> Result<()> {
    info!("[Referral] Checking for installer name file...");

    // Get the install directory (where the executable is located)
    let install_dir = get_install_directory()?;
    let name_file_path = install_dir.join(INSTALLER_NAME_FILENAME);

    debug!(
        "[Referral] Looking for installer name at: {:?}",
        name_file_path
    );

    // Check if installer name file exists
    if !name_file_path.exists() {
        debug!("[Referral] No installer name file found");
        return Ok(());
    }

    // Read the installer filename from file
    let installer_filename = match tokio::fs::read_to_string(&name_file_path).await {
        Ok(content) => content.trim().to_string(),
        Err(e) => {
            error!("[Referral] Failed to read installer name file: {}", e);
            return Ok(()); // Don't fail the startup
        }
    };

    // Parse referral code from filename
    let referral_code = extract_referral_code(&installer_filename);

    if let Some(code) = referral_code {
        info!("[Referral] Found referral code: {}", code);

        // Get state and save to config
        let state = State::get().await?;
        let mut config = state.config_manager.get_config().await;

        // Save referral code to config as ReferralState (redeemed = false)
        config.referral_state = Some(ReferralState {
            code,
            redeemed: false,
            redeemed_at: None,
            redeemed_by_account: None,
        });
        state.config_manager.set_config(config).await?;
        info!("[Referral] Saved referral code to config as ReferralState (redeemed=false)");
    } else {
        debug!("[Referral] No referral code found in installer filename: {}", installer_filename);
    }

    // Delete the installer name file (we've processed it)
    if let Err(e) = tokio::fs::remove_file(&name_file_path).await {
        warn!("[Referral] Failed to delete installer name file: {}", e);
    } else {
        debug!("[Referral] Deleted installer name file");
    }

    Ok(())
}

/// Report pending referral code after login.
/// This function handles getting the Prime token and reporting the referral code.
/// Call this after successful login.
///
/// # Arguments
/// * `account_id` - The Minecraft account UUID of the logged-in user
pub async fn report_referral_after_login(account_id: Uuid) -> Result<()> {
    let state = State::get().await?;
    let config = state.config_manager.get_config().await;

    // Check if we have a referral state that hasn't been redeemed yet
    match &config.referral_state {
        Some(state) if !state.redeemed => {
            debug!("[Referral] Found unredeemed referral code: {}", state.code);
        }
        Some(state) => {
            debug!("[Referral] Referral code already redeemed: {}", state.code);
            return Ok(());
        }
        None => {
            debug!("[Referral] No referral state to report");
            return Ok(());
        }
    }

    let is_experimental = config.is_experimental;

    // Get account with refreshed tokens
    info!("[Referral] Getting account with refreshed tokens for referral report...");
    let credentials = match state
        .minecraft_account_manager_v2
        .get_account_by_id_with_refresh(account_id, is_experimental)
        .await?
    {
        Some(creds) => creds,
        None => {
            warn!("[Referral] Account not found for referral report: {}", account_id);
            return Ok(());
        }
    };

    // Get the token from the refreshed credentials
    let token = if is_experimental {
        &credentials.prime_credentials.experimental
    } else {
        &credentials.prime_credentials.production
    };

    let prime_token = match token {
        Some(t) => &t.value,
        None => {
            warn!("[Referral] Failed to get Prime token for referral report");
            return Ok(());
        }
    };

    // Now report with the token
    report_referral_with_token(prime_token, account_id, is_experimental).await
}

/// Report pending referral code using Prime token (secure, after login).
/// Call this after successful login when we have a valid Prime token.
///
/// # Arguments
/// * `prime_token` - The Prime JWT token for authentication
/// * `account_id` - The Minecraft account UUID
/// * `is_experimental` - Whether to use staging or production API
async fn report_referral_with_token(
    prime_token: &str,
    account_id: Uuid,
    is_experimental: bool,
) -> Result<()> {
    let state = State::get().await?;
    let config = state.config_manager.get_config().await;

    // Check if we have a referral state that hasn't been redeemed
    let referral_state = match &config.referral_state {
        Some(s) if !s.redeemed => s.clone(),
        Some(s) => {
            debug!("[Referral] Referral code already redeemed: {}", s.code);
            return Ok(());
        }
        None => {
            debug!("[Referral] No referral state to report");
            return Ok(());
        }
    };

    info!("[Referral] Reporting referral code: {} for account: {}", referral_state.code, account_id);

    match PrimeApi::report_referral_code(prime_token, &referral_state.code, account_id, is_experimental).await {
        Ok(_) => {
            info!("[Referral] Successfully reported referral code");

            // Get current timestamp
            let timestamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);

            // Update state with redeemed info (code stays!)
            let mut updated_config = state.config_manager.get_config().await;
            updated_config.referral_state = Some(ReferralState {
                code: referral_state.code.clone(),
                redeemed: true,
                redeemed_at: Some(timestamp),
                redeemed_by_account: Some(account_id.to_string()),
            });
            state.config_manager.set_config(updated_config).await?;
            info!("[Referral] Marked referral code as redeemed (code preserved for tracing)");
        }
        Err(e) => {
            warn!("[Referral] Failed to report referral code: {}", e);
            // Keep the state as is, will try again next login
        }
    }

    Ok(())
}

/// Get the installation directory (where the executable is located)
fn get_install_directory() -> Result<PathBuf> {
    // Get the path to the current executable
    let exe_path = std::env::current_exe().map_err(|e| {
        crate::error::AppError::Other(format!("Failed to get executable path: {}", e))
    })?;

    // Get the parent directory
    let install_dir = exe_path.parent().ok_or_else(|| {
        crate::error::AppError::Other("Failed to get install directory".to_string())
    })?;

    Ok(install_dir.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_install_directory() {
        let result = get_install_directory();
        assert!(result.is_ok());
        let dir = result.unwrap();
        assert!(dir.exists());
    }

    #[test]
    fn test_extract_referral_code() {
        assert_eq!(
            extract_referral_code("PrimeClient-Windows-setup-550e8400-e29b-41d4.exe"),
            Some("550e8400-e29b-41d4".to_string())
        );
        assert_eq!(
            extract_referral_code("PrimeClient-Windows-setup-nqrman.exe"),
            Some("nqrman".to_string())
        );
        assert_eq!(
            extract_referral_code("Prime Client_0.6.22_x64-setup.exe"),
            None
        );
        assert_eq!(
            extract_referral_code("setup-123.exe"),
            None
        );
    }
}
