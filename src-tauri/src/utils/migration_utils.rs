use crate::state::profile_state::Profile;
use log::{info, warn};
use std::collections::HashMap;
use uuid::Uuid;

/// Performs profile migrations during startup.
/// Currently handles:
/// - Migration from "prime-dev" to "prime-prod" pack IDs
pub fn migrate_profiles(profiles: &mut HashMap<Uuid, Profile>) -> usize {
    let mut migration_count = 0;
    
    // Migration 1: prime-dev → prime-prod
    migration_count += migrate_prime_pack_ids(profiles);
    
    if migration_count > 0 {
        info!("ProfileManager: Completed profile migrations. Total changes: {}", migration_count);
    }
    
    migration_count
}

/// Migrates profiles from "prime-dev" to "prime-prod" pack ID
fn migrate_prime_pack_ids(profiles: &mut HashMap<Uuid, Profile>) -> usize {
    let mut migrated_count = 0;
    
    for (_, profile) in profiles.iter_mut() {
        if profile.selected_prime_pack_id == Some("prime-dev".to_string()) {
            info!(
                "Migrating profile '{}' (ID: {}) from prime-dev to prime-prod", 
                profile.name, 
                profile.id
            );
            
            profile.selected_prime_pack_id = Some("prime-prod".to_string());
            migrated_count += 1;
        }
    }
    
    if migrated_count > 0 {
        info!("Migration: Updated {} profiles from prime-dev to prime-prod", migrated_count);
    }
    
    migrated_count
}