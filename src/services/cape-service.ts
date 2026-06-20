import { invoke } from '@tauri-apps/api/core';
import type { CapesBrowseResponse, BrowseCapesOptions, GetPlayerCapesPayloadOptions, CosmeticCape, OwnedCapesResponse } from '../types/primeCapes';
import type { MinecraftProfile } from '../types/minecraft';

export const getCapeImageUrl = (hash: string, isExperimental: boolean): string => {
  const base = isExperimental ? 'https://cdn.prime.gg/capes-staging/prod' : 'https://cdn.prime.gg/capes/prod';
  return `${base}/${hash}.png`;
};

export const getCapeReviewImageUrl = (hash: string, isExperimental: boolean): string => {
  const base = isExperimental ? 'https://cdn.prime.gg/capes-staging/review' : 'https://cdn.prime.gg/capes/review';
  return `${base}/${hash}.png`;
};

/**
 * Browse capes with optional parameters
 * 
 * @param options Options for browsing capes including pagination, filtering and sorting
 * @returns A promise that resolves to a CapesBrowseResponse
 */
export const browseCapes = (options: BrowseCapesOptions = {}): Promise<CapesBrowseResponse> => {
  // Log the options object that will be wrapped in the payload
  console.log('[cape-service] browseCapes called with options for payload:', options);

  return invoke('browse_capes', { 
    payload: options // Pass the options object as the 'payload' field
  });
};

/**
 * Get capes for a specific player. Now uses a payload object.
 * 
 * @param options Options for retrieving player capes, including playerIdentifier (UUID or name)
 * @returns A promise that resolves to an array of CosmeticCape objects
 */
export const getPlayerCapes = (
  options: GetPlayerCapesPayloadOptions // Single options/payload argument
): Promise<CosmeticCape[]> => {
  // Log the options object that will be wrapped in the payload
  console.log('[cape-service] getPlayerCapes called with options for payload:', options);
  return invoke('get_player_capes', {
    payload: options // Pass the options object as the 'payload' field, Tauri handles camel to snake_case
  });
};

/**
 * Equip a specific cape for a player
 * 
 * @param capeHash Hash of the cape to equip
 * @param primeToken Optional Prime token
 * @param playerUuid Optional UUID of the player (defaults to active account)
 * @returns A promise that resolves when the cape is equipped
 */
export const equipCape = (
  capeHash: string,
  primeToken?: string,
  playerUuid?: string
): Promise<void> => {
  return invoke('equip_cape', {
     capeHash,
     primeToken,
     playerUuid
  });
};

/**
 * Delete a specific cape owned by the player
 * 
 * @param capeHash Hash of the cape to delete
 * @param primeToken Optional Prime token
 * @param playerUuid Optional UUID of the player (defaults to active account)
 * @returns A promise that resolves when the cape is deleted
 */
export const deleteCape = (
  capeHash: string,
  primeToken?: string,
  playerUuid?: string,
  reason?: string
): Promise<void> => {
  return invoke('delete_cape', {
    capeHash,
    primeToken,
    playerUuid,
    reason
  });
};

export const checkIsModerator = (): Promise<boolean> => {
  return invoke('check_is_moderator');
};

/**
 * Response from cape upload operation
 */
export interface CapeUploadResponse {
  capeHash: string;
}

/**
 * Upload a new cape image for the active player
 *
 * @param imagePath Path to the cape image file (PNG)
 * @param primeToken Optional Prime token
 * @param playerUuid Optional UUID of the player (defaults to active account)
 * @returns A promise that resolves to the cape upload response with hash
 */
export const uploadCape = (
  imagePath: string,
  primeToken?: string,
  playerUuid?: string
): Promise<CapeUploadResponse> => {
  return invoke('upload_cape', {
    imagePath,
    primeToken,
    playerUuid
  });
};

/**
 * Unequip the currently equipped cape for the active player
 * 
 * @param primeToken Optional Prime token
 * @param playerUuid Optional UUID of the player (defaults to active account)
 * @returns A promise that resolves when the cape is unequipped
 */
export const unequipCape = (
  primeToken?: string,
  playerUuid?: string
): Promise<void> => {
  return invoke('unequip_cape', {
    primeToken,
    playerUuid
  });
};

/**
 * Download a cape template PNG and open the containing folder in the file explorer
 * 
 * @returns A promise that resolves when the template has been downloaded and the folder is opened
 */
export const downloadTemplateAndOpenExplorer = (withElytra: boolean): Promise<void> => {
  console.log('[cape-service] Downloading cape template and opening explorer (elytra:', withElytra, ')');
  return invoke('download_template_and_open_explorer', { withElytra });
};

/**
 * Fetches a Minecraft profile by player name or UUID.
 * Corresponds to the Rust `get_profile_by_name_or_uuid` command.
 *
 * @param nameOrUuidQuery - The player's name or UUID to query.
 * @returns A promise that resolves to a `MinecraftProfile` object.
 * @throws If the backend command fails.
 */
export const getPlayerProfileByUuidOrName = (nameOrUuidQuery: string): Promise<MinecraftProfile> => {
  return invoke('get_profile_by_name_or_uuid', { nameOrUuidQuery });
}; 

/**
 * Add a cape to the user's favorites (server-backed)
 * Returns the updated list of favorite cape hashes
 */
export const addFavoriteCape = (
  capeHash: string,
  primeToken?: string,
): Promise<string[]> => {
  return invoke('add_favorite_cape', { capeHash, primeToken });
};

/**
 * Remove a cape from the user's favorites (server-backed)
 * Returns the updated list of favorite cape hashes
 */
export const removeFavoriteCape = (
  capeHash: string,
  primeToken?: string,
): Promise<string[]> => {
  return invoke('remove_favorite_cape', { capeHash, primeToken });
};

/**
 * Smart helper: set favorite state for a cape.
 * Calls add or remove on the backend and returns the updated favorites list.
 */
export const setCapeFavorite = async (
  capeHash: string,
  favorite: boolean,
  primeToken?: string,
): Promise<string[]> => {
  if (favorite) {
    return addFavoriteCape(capeHash, primeToken);
  }
  return removeFavoriteCape(capeHash, primeToken);
};

/**
 * Smart helper: toggle favorite by current state (client-known)
 */
export const toggleCapeFavorite = async (
  capeHash: string,
  isCurrentlyFavorite: boolean,
  primeToken?: string,
): Promise<string[]> => {
  return setCapeFavorite(capeHash, !isCurrentlyFavorite, primeToken);
}; 

/**
 * Fetch multiple capes by hashes (max 100)
 */
export const getCapesByHashes = (
  hashes: string[],
  primeToken?: string,
): Promise<CosmeticCape[]> => {
  return invoke('get_capes_by_hashes', { hashes, primeToken });
};

export const getOwnedCapesList = (
  page?: number,
  limit?: number,
  primeToken?: string,
): Promise<OwnedCapesResponse> => {
  return invoke('get_owned_capes_list', { page, limit, primeToken });
};