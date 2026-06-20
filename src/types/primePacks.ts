// src/lib/types/primePacks.ts

// Types matching backend Rust structures for Prime Packs

// Corresponds to Rust struct CompatibilityTarget
export interface CompatibilityTarget {
    identifier: string;
    filename: string | null;
}

// Corresponds to Rust enum PrimeModSourceDefinition
export type PrimeModSourceDefinition =
    | { type: 'modrinth'; project_id: string; project_slug: string } // Renamed fields to snake_case
    | { type: 'maven'; repository_ref: string; group_id: string; artifact_id: string } // Renamed fields to snake_case
    | { type: 'url' };

// Corresponds to Rust struct PrimeModEntryDefinition (previously PrimePackMod)
export interface PrimeModEntryDefinition { // Renamed from PrimePackMod
    id: string;
    displayName?: string | null; // Made optional
    source: PrimeModSourceDefinition; // Updated type
    // compatibility field structure: Record<GameVersion, Record<Loader, CompatibilityTarget>>
    compatibility?: Record<string,
        Record<string, CompatibilityTarget> // Updated inner type
    >;
}

// Corresponds to Rust struct PrimePackDefinition
export interface PrimePackDefinition {
    displayName: string; // Correct
    description: string; // Correct
    inheritsFrom?: string[] | null; // Added field
    excludeMods?: string[] | null; // Added field
    mods?: PrimeModEntryDefinition[]; // Updated type used
    assets?: string[]; // Added field
    isExperimental?: boolean; // Added field
}

// Corresponds to Rust struct PrimeModpacksConfig
export interface PrimeModpacksConfig {
    packs: Record<string, PrimePackDefinition>; // Maps pack ID (string) to definition
    repositories: Record<string, string>; // Maps repository reference (string) to URL (string)
} 