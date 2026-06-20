# PrimeClient StartUpHelper

Dieser Ordner enthält Dateien, die automatisch in neue Profile kopiert werden können.

## Funktionsweise

Das StartUpHelper Feature erlaubt es, zusätzliche Dateien aus diesem Verzeichnis in neue Minecraft-Profile zu kopieren. Die Dateien werden nur kopiert, wenn:

1. Das Profil ein Standard-Profil ist (`is_standard_version: true`)
2. Das Profil-Verzeichnis leer ist (beim ersten Start)
3. Die Zieldatei noch nicht existiert

## Ausführungsreihenfolge

1. **StartUpHelper Copy** (dieses Feature) - kopiert benutzerdefinierte Dateien
2. **Standard Minecraft Copy** - kopiert Standard-Minecraft-Dateien

⚠️ **Wichtig**: StartUpHelper-Dateien können durch Standard-Minecraft-Dateien überschrieben werden, falls diese denselben Pfad haben. Dies ermöglicht eine saubere Trennung zwischen benutzerdefinierten und Standard-Dateien.

## Struktur

```
primeclient/
├── new/                    # StartUpHelper Quellordner
│   ├── options.txt        # Beispiel: Standard-Optionen
│   ├── config/
│   │   └── hi.json       # Beispiel: PrimeClient Konfiguration
│   └── mods/
│       └── example.jar   # Beispiel: Standard-Mods
└── [andere PrimeClient Dateien...]
```

## Verwendung

Um StartUpHelper zu aktivieren, füge in einem Profil folgende Konfiguration hinzu:

```json
{
  "prime_information": {
    "startup_helper": {
      "additional_paths": [
        "options.txt",
        "config/hi.json"
      ]
    }
  }
}
```

## Pfad-Auflösung

- **Quelle**: `{default_profile_path}/primeclient/new/{relative_path}`
- **Ziel**: `{profile_dir}/{relative_path}`

Beispiel:
- Quelle: `~/Library/Application Support/gg/prime/PrimeClientV3/profiles/primeclient/new/options.txt`
- Ziel: `~/Library/Application Support/gg/prime/PrimeClientV3/profiles/{profile-id}/options.txt`

## Unterstützte Dateitypen

- **Einzelne Dateien**: `.txt`, `.json`, `.cfg`, etc.
- **Verzeichnisse**: Werden **vollständig rekursiv** kopiert mit allen Unterverzeichnissen und Dateien
- **Beispiele**:
  - `"options.txt"` → Kopiert eine einzelne Datei
  - `"saves"` → Kopiert den **kompletten** `saves` Ordner mit allen Welten
  - `"config/hi.json"` → Kopiert eine einzelne Datei in einem Unterordner
  - `"mods"` → Kopiert den **kompletten** `mods` Ordner mit allen Mods

## Praxisbeispiele

```json
{
  "prime_information": {
    "startup_helper": {
      "additional_paths": [
        "options.txt",
        "saves",           // ← Kopiert komplette Welten-Ordner
        "config",
        "mods"            // ← Kopiert komplette Mod-Sammlung
      ]
    }
  }
}
```
