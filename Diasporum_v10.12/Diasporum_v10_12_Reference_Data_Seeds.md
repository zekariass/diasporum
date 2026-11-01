# Diasporum v10.12 — Reference Data Seeds

This document describes the baseline reference data seeded into a fresh Diasporum v10.12
development/local environment. All seeds are idempotent and safe to re-run.

---

## Architecture

### `TaxonomyReferenceSeeder`

Location: `diasporum-backend/src/main/java/com/diasporum/backend/taxonomy/internal/application/TaxonomyReferenceSeeder.java`

A Spring `@Service` that exposes four idempotent upsert methods:

| Method | Natural key | Conflict behaviour |
|---|---|---|
| `seedCountries(List<CountrySeed>)` | `iso2` | `DO UPDATE` display fields; preserves `is_active` |
| `seedLanguages(List<LanguageSeed>)` | `language_code` | `DO UPDATE` display fields; preserves `is_active` |
| `seedInterests(List<InterestSeed>)` | `interest_key` | `DO UPDATE` display fields; preserves `is_active` |
| `seedCommunities(List<CommunitySeed>)` | `(origin_country_id, destination_country_id)` | `DO NOTHING`; never overwrites admin-curated entries |

### `TaxonomyStartupSeeder`

Location: `diasporum-backend/src/main/java/com/diasporum/backend/taxonomy/internal/application/TaxonomyStartupSeeder.java`

A Spring `@Component` implementing `ApplicationRunner` that runs once after the Spring
context starts. Behaviour:

- **Countries + languages**: seeded only when `SELECT count(*) FROM countries` is below the
  threshold of 50. Once a real deployment has been curated the seed is skipped automatically.
- **Communities**: always attempted on every boot using `ON CONFLICT DO NOTHING`, so that
  dev corridors are present on fresh databases without ever overwriting admin-managed entries.

---

## Countries

**195 countries** covering all UN-recognised states plus Taiwan and Palestine.

Each row contains:

| Column | Value source |
|---|---|
| `name` | English display name |
| `iso2` | ISO 3166-1 alpha-2 (uppercase, natural key) |
| `iso3` | ISO 3166-1 alpha-3 |
| `demonym` | English demonym (e.g. "Ethiopian", "British") |
| `flag_emoji` | Computed at seed time from ISO-2 via Unicode regional indicator symbols (U+1F1E6–U+1F1FF) |
| `is_active` | `true` (schema default) |

Flag emoji formula (Java):
```java
int base = 0x1F1E6 - 'A';
String flag = new String(Character.toChars(base + 'G')) +
              new String(Character.toChars(base + 'B')); // → 🇬🇧
```

### Full country list

Afghanistan (AF), Albania (AL), Algeria (DZ), Andorra (AD), Angola (AO),
Antigua and Barbuda (AG), Argentina (AR), Armenia (AM), Australia (AU), Austria (AT),
Azerbaijan (AZ), Bahamas (BS), Bahrain (BH), Bangladesh (BD), Barbados (BB),
Belarus (BY), Belgium (BE), Belize (BZ), Benin (BJ), Bhutan (BT), Bolivia (BO),
Bosnia and Herzegovina (BA), Botswana (BW), Brazil (BR), Brunei (BN), Bulgaria (BG),
Burkina Faso (BF), Burundi (BI), Cabo Verde (CV), Cambodia (KH), Cameroon (CM),
Canada (CA), Central African Republic (CF), Chad (TD), Chile (CL), China (CN),
Colombia (CO), Comoros (KM), Congo DRC (CD), Congo Republic (CG), Costa Rica (CR),
Ivory Coast (CI), Croatia (HR), Cuba (CU), Cyprus (CY), Czech Republic (CZ),
Denmark (DK), Djibouti (DJ), Dominica (DM), Dominican Republic (DO), Ecuador (EC),
Egypt (EG), El Salvador (SV), Equatorial Guinea (GQ), Eritrea (ER), Estonia (EE),
Eswatini (SZ), Ethiopia (ET), Fiji (FJ), Finland (FI), France (FR), Gabon (GA),
Gambia (GM), Georgia (GE), Germany (DE), Ghana (GH), Greece (GR), Grenada (GD),
Guatemala (GT), Guinea (GN), Guinea-Bissau (GW), Guyana (GY), Haiti (HT),
Honduras (HN), Hungary (HU), Iceland (IS), India (IN), Indonesia (ID), Iran (IR),
Iraq (IQ), Ireland (IE), Israel (IL), Italy (IT), Jamaica (JM), Japan (JP),
Jordan (JO), Kazakhstan (KZ), Kenya (KE), Kiribati (KI), Kuwait (KW),
Kyrgyzstan (KG), Laos (LA), Latvia (LV), Lebanon (LB), Lesotho (LS), Liberia (LR),
Libya (LY), Liechtenstein (LI), Lithuania (LT), Luxembourg (LU), Madagascar (MG),
Malawi (MW), Malaysia (MY), Maldives (MV), Mali (ML), Malta (MT),
Marshall Islands (MH), Mauritania (MR), Mauritius (MU), Mexico (MX),
Micronesia (FM), Moldova (MD), Monaco (MC), Mongolia (MN), Montenegro (ME),
Morocco (MA), Mozambique (MZ), Myanmar (MM), Namibia (NA), Nauru (NR), Nepal (NP),
Netherlands (NL), New Zealand (NZ), Nicaragua (NI), Niger (NE), Nigeria (NG),
North Korea (KP), North Macedonia (MK), Norway (NO), Oman (OM), Pakistan (PK),
Palau (PW), Palestine (PS), Panama (PA), Papua New Guinea (PG), Paraguay (PY),
Peru (PE), Philippines (PH), Poland (PL), Portugal (PT), Qatar (QA), Romania (RO),
Russia (RU), Rwanda (RW), Saint Kitts and Nevis (KN), Saint Lucia (LC),
Saint Vincent and the Grenadines (VC), Samoa (WS), San Marino (SM),
São Tomé and Príncipe (ST), Saudi Arabia (SA), Senegal (SN), Serbia (RS),
Seychelles (SC), Sierra Leone (SL), Singapore (SG), Slovakia (SK), Slovenia (SI),
Solomon Islands (SB), Somalia (SO), South Africa (ZA), South Korea (KR),
South Sudan (SS), Spain (ES), Sri Lanka (LK), Sudan (SD), Suriname (SR),
Sweden (SE), Switzerland (CH), Syria (SY), Taiwan (TW), Tajikistan (TJ),
Tanzania (TZ), Thailand (TH), Timor-Leste (TL), Togo (TG), Tonga (TO),
Trinidad and Tobago (TT), Tunisia (TN), Turkey (TR), Turkmenistan (TM),
Tuvalu (TV), Uganda (UG), Ukraine (UA), United Arab Emirates (AE),
United Kingdom (GB), United States (US), Uruguay (UY), Uzbekistan (UZ),
Vanuatu (VU), Venezuela (VE), Vietnam (VN), Yemen (YE), Zambia (ZM), Zimbabwe (ZW)

---

## Languages

**30 languages** covering the major diaspora-community languages.

| # | Code | Display name |
|---|---|---|
| 1 | `en` | English |
| 2 | `fr` | French |
| 3 | `es` | Spanish |
| 4 | `ar` | Arabic |
| 5 | `pt` | Portuguese |
| 6 | `zh` | Chinese (Mandarin) |
| 7 | `hi` | Hindi |
| 8 | `de` | German |
| 9 | `ru` | Russian |
| 10 | `ja` | Japanese |
| 11 | `ko` | Korean |
| 12 | `it` | Italian |
| 13 | `tr` | Turkish |
| 14 | `pl` | Polish |
| 15 | `nl` | Dutch |
| 16 | `sv` | Swedish |
| 17 | `fa` | Persian (Farsi) |
| 18 | `uk` | Ukrainian |
| 19 | `ro` | Romanian |
| 20 | `vi` | Vietnamese |
| 21 | `am` | Amharic |
| 22 | `sw` | Swahili |
| 23 | `so` | Somali |
| 24 | `ha` | Hausa |
| 25 | `yo` | Yoruba |
| 26 | `ig` | Igbo |
| 27 | `bn` | Bengali |
| 28 | `ur` | Urdu |
| 29 | `tl` | Filipino (Tagalog) |
| 30 | `ti` | Tigrinya |

---

## Communities (development / demo corridors)

**55 diaspora corridors** seeded for development and demo purposes.  
Schema: `communities(name, slug, origin_country_id, destination_country_id, description, is_active)`.  
Slug pattern: `{origin_iso2_lower}-diaspora-in-{dest_iso2_lower}` (e.g. `et-diaspora-in-gb`).

> **Note:** The `availableCommunities` API filters communities by the user's `origin_country_id`
> (set during onboarding). A user whose origin country is Ethiopia will see the six Ethiopian
> corridors below.

| Origin | → Destination | Community name |
|---|---|---|
| 🇪🇹 Ethiopia | 🇬🇧 United Kingdom | Ethiopian community in the UK |
| 🇪🇹 Ethiopia | 🇺🇸 United States | Ethiopian community in the US |
| 🇪🇹 Ethiopia | 🇩🇪 Germany | Ethiopian community in Germany |
| 🇪🇹 Ethiopia | 🇨🇦 Canada | Ethiopian community in Canada |
| 🇪🇹 Ethiopia | 🇦🇺 Australia | Ethiopian community in Australia |
| 🇪🇹 Ethiopia | 🇸🇪 Sweden | Ethiopian community in Sweden |
| 🇳🇬 Nigeria | 🇬🇧 United Kingdom | Nigerian community in the UK |
| 🇳🇬 Nigeria | 🇺🇸 United States | Nigerian community in the US |
| 🇳🇬 Nigeria | 🇨🇦 Canada | Nigerian community in Canada |
| 🇳🇬 Nigeria | 🇩🇪 Germany | Nigerian community in Germany |
| 🇳🇬 Nigeria | 🇮🇪 Ireland | Nigerian community in Ireland |
| 🇮🇳 India | 🇬🇧 United Kingdom | Indian community in the UK |
| 🇮🇳 India | 🇺🇸 United States | Indian community in the US |
| 🇮🇳 India | 🇨🇦 Canada | Indian community in Canada |
| 🇮🇳 India | 🇦🇺 Australia | Indian community in Australia |
| 🇮🇳 India | 🇦🇪 UAE | Indian community in the UAE |
| 🇸🇴 Somalia | 🇬🇧 United Kingdom | Somali community in the UK |
| 🇸🇴 Somalia | 🇺🇸 United States | Somali community in the US |
| 🇸🇴 Somalia | 🇳🇴 Norway | Somali community in Norway |
| 🇸🇴 Somalia | 🇸🇪 Sweden | Somali community in Sweden |
| 🇸🇴 Somalia | 🇨🇦 Canada | Somali community in Canada |
| 🇪🇷 Eritrea | 🇬🇧 United Kingdom | Eritrean community in the UK |
| 🇪🇷 Eritrea | 🇺🇸 United States | Eritrean community in the US |
| 🇪🇷 Eritrea | 🇩🇪 Germany | Eritrean community in Germany |
| 🇪🇷 Eritrea | 🇸🇪 Sweden | Eritrean community in Sweden |
| 🇬🇭 Ghana | 🇬🇧 United Kingdom | Ghanaian community in the UK |
| 🇬🇭 Ghana | 🇺🇸 United States | Ghanaian community in the US |
| 🇬🇭 Ghana | 🇩🇪 Germany | Ghanaian community in Germany |
| 🇬🇭 Ghana | 🇮🇹 Italy | Ghanaian community in Italy |
| 🇰🇪 Kenya | 🇬🇧 United Kingdom | Kenyan community in the UK |
| 🇰🇪 Kenya | 🇺🇸 United States | Kenyan community in the US |
| 🇰🇪 Kenya | 🇨🇦 Canada | Kenyan community in Canada |
| 🇰🇪 Kenya | 🇦🇺 Australia | Kenyan community in Australia |
| 🇵🇰 Pakistan | 🇬🇧 United Kingdom | Pakistani community in the UK |
| 🇵🇰 Pakistan | 🇺🇸 United States | Pakistani community in the US |
| 🇵🇰 Pakistan | 🇦🇪 UAE | Pakistani community in the UAE |
| 🇵🇰 Pakistan | 🇨🇦 Canada | Pakistani community in Canada |
| 🇵🇭 Philippines | 🇺🇸 United States | Filipino community in the US |
| 🇵🇭 Philippines | 🇦🇪 UAE | Filipino community in the UAE |
| 🇵🇭 Philippines | 🇬🇧 United Kingdom | Filipino community in the UK |
| 🇵🇭 Philippines | 🇨🇦 Canada | Filipino community in Canada |
| 🇵🇭 Philippines | 🇦🇺 Australia | Filipino community in Australia |
| 🇲🇽 Mexico | 🇺🇸 United States | Mexican community in the US |
| 🇲🇽 Mexico | 🇨🇦 Canada | Mexican community in Canada |
| 🇧🇷 Brazil | 🇺🇸 United States | Brazilian community in the US |
| 🇧🇷 Brazil | 🇵🇹 Portugal | Brazilian community in Portugal |
| 🇧🇷 Brazil | 🇬🇧 United Kingdom | Brazilian community in the UK |
| 🇸🇾 Syria | 🇩🇪 Germany | Syrian community in Germany |
| 🇸🇾 Syria | 🇹🇷 Turkey | Syrian community in Turkey |
| 🇸🇾 Syria | 🇸🇪 Sweden | Syrian community in Sweden |
| 🇸🇾 Syria | 🇬🇧 United Kingdom | Syrian community in the UK |
| 🇨🇳 China | 🇺🇸 United States | Chinese community in the US |
| 🇨🇳 China | 🇦🇺 Australia | Chinese community in Australia |
| 🇨🇳 China | 🇨🇦 Canada | Chinese community in Canada |
| 🇨🇳 China | 🇬🇧 United Kingdom | Chinese community in the UK |

---

## Schema changes accompanying these seeds

### Flyway V3 — `V3__relax_profile_not_null_for_onboarding.sql`

Removes premature NOT NULL constraints on `profiles` so the profile can be built
progressively during onboarding. Completion is still tracked by `profile_completed_at`
(stamped by application logic when `display_name`, `username`, `origin_country_id` and
`current_country_id` are all non-null).

```sql
ALTER TABLE profiles ALTER COLUMN display_name      DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN origin_country_id  DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN current_country_id DROP NOT NULL;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_display_name_check;
ALTER TABLE profiles ADD  CONSTRAINT profiles_display_name_check
    CHECK (display_name IS NULL OR length(trim(display_name)) BETWEEN 1 AND 80);
```

### `ProfileService.updateProfile` upsert

`PATCH /api/v1/me/profile` now begins with:

```java
jdbc.update("INSERT INTO profiles(id) VALUES(?) ON CONFLICT(id) DO NOTHING", profileId);
```

This ensures a profile row exists for new users before the field updates run,
eliminating the `404 PROFILE_NOT_FOUND` error that occurred when a brand-new user
selected their country of origin on the first onboarding step.

---

## Re-seeding a fresh environment

If you drop and recreate `diasporum_dev`, the `TaxonomyStartupSeeder` will re-seed
everything on the next backend startup (country count will be 0 < threshold 50).

For an emergency manual re-seed without a restart, run the two SQL scripts that were
used during initial setup:

```
seed_reference_data.sql   — countries + languages
seed_communities.sql      — 55 dev community corridors
```

Both files are located at the project root (`C:\PROJECT\DIASPORUM\`).
