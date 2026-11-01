package com.diasporum.backend.taxonomy.internal.application;

import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Seeds baseline reference data (countries, languages, dev communities) on startup.
 * Uses the idempotent {@link TaxonomyReferenceSeeder} — safe to run on every boot.
 * Skips country/language seeding when the countries table already has
 * {@value #SEED_THRESHOLD} or more rows. Community seeding uses ON CONFLICT DO NOTHING
 * so it never overwrites admin-curated entries.
 */
@Component
class TaxonomyStartupSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(TaxonomyStartupSeeder.class);
    private static final int SEED_THRESHOLD = 50;

    private final TaxonomyReferenceSeeder seeder;
    private final JdbcTemplate jdbc;

    TaxonomyStartupSeeder(TaxonomyReferenceSeeder seeder, JdbcTemplate jdbc) {
        this.seeder = seeder;
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM countries", Integer.class);
        if (count != null && count >= SEED_THRESHOLD) {
            log.info("[taxonomy] Skipping country/language seed: {} countries already present", count);
        } else {
            log.info("[taxonomy] Seeding reference data (existing country rows: {})", count);
            int countries = seeder.seedCountries(COUNTRIES);
            int languages = seeder.seedLanguages(LANGUAGES);
            log.info("[taxonomy] Seeded {} country rows, {} language rows", countries, languages);
        }

        // Always attempt community seeding — ON CONFLICT DO NOTHING preserves admin entries.
        int communities = seeder.seedCommunities(DEV_COMMUNITIES);
        if (communities > 0) {
            log.info("[taxonomy] Seeded {} dev community rows", communities);
        }
    }

    /** Derives the Unicode flag emoji from a 2-letter ISO 3166-1 alpha-2 code. */
    private static String flag(String iso2) {
        int base = 0x1F1E6 - 'A';
        String a = new String(Character.toChars(base + Character.toUpperCase(iso2.charAt(0))));
        String b = new String(Character.toChars(base + Character.toUpperCase(iso2.charAt(1))));
        return a + b;
    }

    private static TaxonomyReferenceSeeder.CountrySeed c(
            String name, String iso2, String iso3, String demonym) {
        return new TaxonomyReferenceSeeder.CountrySeed(name, iso2, iso3, demonym, flag(iso2));
    }

    // 197 UN-recognised countries + Taiwan + Palestine
    private static final List<TaxonomyReferenceSeeder.CountrySeed> COUNTRIES = List.of(
        c("Afghanistan",                      "AF", "AFG", "Afghan"),
        c("Albania",                          "AL", "ALB", "Albanian"),
        c("Algeria",                          "DZ", "DZA", "Algerian"),
        c("Andorra",                          "AD", "AND", "Andorran"),
        c("Angola",                           "AO", "AGO", "Angolan"),
        c("Antigua and Barbuda",              "AG", "ATG", "Antiguan"),
        c("Argentina",                        "AR", "ARG", "Argentine"),
        c("Armenia",                          "AM", "ARM", "Armenian"),
        c("Australia",                        "AU", "AUS", "Australian"),
        c("Austria",                          "AT", "AUT", "Austrian"),
        c("Azerbaijan",                       "AZ", "AZE", "Azerbaijani"),
        c("Bahamas",                          "BS", "BHS", "Bahamian"),
        c("Bahrain",                          "BH", "BHR", "Bahraini"),
        c("Bangladesh",                       "BD", "BGD", "Bangladeshi"),
        c("Barbados",                         "BB", "BRB", "Barbadian"),
        c("Belarus",                          "BY", "BLR", "Belarusian"),
        c("Belgium",                          "BE", "BEL", "Belgian"),
        c("Belize",                           "BZ", "BLZ", "Belizean"),
        c("Benin",                            "BJ", "BEN", "Beninese"),
        c("Bhutan",                           "BT", "BTN", "Bhutanese"),
        c("Bolivia",                          "BO", "BOL", "Bolivian"),
        c("Bosnia and Herzegovina",           "BA", "BIH", "Bosnian"),
        c("Botswana",                         "BW", "BWA", "Motswana"),
        c("Brazil",                           "BR", "BRA", "Brazilian"),
        c("Brunei",                           "BN", "BRN", "Bruneian"),
        c("Bulgaria",                         "BG", "BGR", "Bulgarian"),
        c("Burkina Faso",                     "BF", "BFA", "Burkinabé"),
        c("Burundi",                          "BI", "BDI", "Burundian"),
        c("Cabo Verde",                       "CV", "CPV", "Cape Verdean"),
        c("Cambodia",                         "KH", "KHM", "Cambodian"),
        c("Cameroon",                         "CM", "CMR", "Cameroonian"),
        c("Canada",                           "CA", "CAN", "Canadian"),
        c("Central African Republic",         "CF", "CAF", "Central African"),
        c("Chad",                             "TD", "TCD", "Chadian"),
        c("Chile",                            "CL", "CHL", "Chilean"),
        c("China",                            "CN", "CHN", "Chinese"),
        c("Colombia",                         "CO", "COL", "Colombian"),
        c("Comoros",                          "KM", "COM", "Comorian"),
        c("Congo (DRC)",                      "CD", "COD", "Congolese"),
        c("Congo (Republic)",                 "CG", "COG", "Congolese"),
        c("Costa Rica",                       "CR", "CRI", "Costa Rican"),
        c("Ivory Coast",                      "CI", "CIV", "Ivorian"),
        c("Croatia",                          "HR", "HRV", "Croatian"),
        c("Cuba",                             "CU", "CUB", "Cuban"),
        c("Cyprus",                           "CY", "CYP", "Cypriot"),
        c("Czech Republic",                   "CZ", "CZE", "Czech"),
        c("Denmark",                          "DK", "DNK", "Danish"),
        c("Djibouti",                         "DJ", "DJI", "Djiboutian"),
        c("Dominica",                         "DM", "DMA", "Dominican"),
        c("Dominican Republic",               "DO", "DOM", "Dominican"),
        c("Ecuador",                          "EC", "ECU", "Ecuadorian"),
        c("Egypt",                            "EG", "EGY", "Egyptian"),
        c("El Salvador",                      "SV", "SLV", "Salvadoran"),
        c("Equatorial Guinea",                "GQ", "GNQ", "Equatorial Guinean"),
        c("Eritrea",                          "ER", "ERI", "Eritrean"),
        c("Estonia",                          "EE", "EST", "Estonian"),
        c("Eswatini",                         "SZ", "SWZ", "Swazi"),
        c("Ethiopia",                         "ET", "ETH", "Ethiopian"),
        c("Fiji",                             "FJ", "FJI", "Fijian"),
        c("Finland",                          "FI", "FIN", "Finnish"),
        c("France",                           "FR", "FRA", "French"),
        c("Gabon",                            "GA", "GAB", "Gabonese"),
        c("Gambia",                           "GM", "GMB", "Gambian"),
        c("Georgia",                          "GE", "GEO", "Georgian"),
        c("Germany",                          "DE", "DEU", "German"),
        c("Ghana",                            "GH", "GHA", "Ghanaian"),
        c("Greece",                           "GR", "GRC", "Greek"),
        c("Grenada",                          "GD", "GRD", "Grenadian"),
        c("Guatemala",                        "GT", "GTM", "Guatemalan"),
        c("Guinea",                           "GN", "GIN", "Guinean"),
        c("Guinea-Bissau",                    "GW", "GNB", "Bissau-Guinean"),
        c("Guyana",                           "GY", "GUY", "Guyanese"),
        c("Haiti",                            "HT", "HTI", "Haitian"),
        c("Honduras",                         "HN", "HND", "Honduran"),
        c("Hungary",                          "HU", "HUN", "Hungarian"),
        c("Iceland",                          "IS", "ISL", "Icelandic"),
        c("India",                            "IN", "IND", "Indian"),
        c("Indonesia",                        "ID", "IDN", "Indonesian"),
        c("Iran",                             "IR", "IRN", "Iranian"),
        c("Iraq",                             "IQ", "IRQ", "Iraqi"),
        c("Ireland",                          "IE", "IRL", "Irish"),
        c("Israel",                           "IL", "ISR", "Israeli"),
        c("Italy",                            "IT", "ITA", "Italian"),
        c("Jamaica",                          "JM", "JAM", "Jamaican"),
        c("Japan",                            "JP", "JPN", "Japanese"),
        c("Jordan",                           "JO", "JOR", "Jordanian"),
        c("Kazakhstan",                       "KZ", "KAZ", "Kazakhstani"),
        c("Kenya",                            "KE", "KEN", "Kenyan"),
        c("Kiribati",                         "KI", "KIR", "I-Kiribati"),
        c("Kuwait",                           "KW", "KWT", "Kuwaiti"),
        c("Kyrgyzstan",                       "KG", "KGZ", "Kyrgyz"),
        c("Laos",                             "LA", "LAO", "Laotian"),
        c("Latvia",                           "LV", "LVA", "Latvian"),
        c("Lebanon",                          "LB", "LBN", "Lebanese"),
        c("Lesotho",                          "LS", "LSO", "Basotho"),
        c("Liberia",                          "LR", "LBR", "Liberian"),
        c("Libya",                            "LY", "LBY", "Libyan"),
        c("Liechtenstein",                    "LI", "LIE", "Liechtensteiner"),
        c("Lithuania",                        "LT", "LTU", "Lithuanian"),
        c("Luxembourg",                       "LU", "LUX", "Luxembourgish"),
        c("Madagascar",                       "MG", "MDG", "Malagasy"),
        c("Malawi",                           "MW", "MWI", "Malawian"),
        c("Malaysia",                         "MY", "MYS", "Malaysian"),
        c("Maldives",                         "MV", "MDV", "Maldivian"),
        c("Mali",                             "ML", "MLI", "Malian"),
        c("Malta",                            "MT", "MLT", "Maltese"),
        c("Marshall Islands",                 "MH", "MHL", "Marshallese"),
        c("Mauritania",                       "MR", "MRT", "Mauritanian"),
        c("Mauritius",                        "MU", "MUS", "Mauritian"),
        c("Mexico",                           "MX", "MEX", "Mexican"),
        c("Micronesia",                       "FM", "FSM", "Micronesian"),
        c("Moldova",                          "MD", "MDA", "Moldovan"),
        c("Monaco",                           "MC", "MCO", "Monégasque"),
        c("Mongolia",                         "MN", "MNG", "Mongolian"),
        c("Montenegro",                       "ME", "MNE", "Montenegrin"),
        c("Morocco",                          "MA", "MAR", "Moroccan"),
        c("Mozambique",                       "MZ", "MOZ", "Mozambican"),
        c("Myanmar",                          "MM", "MMR", "Burmese"),
        c("Namibia",                          "NA", "NAM", "Namibian"),
        c("Nauru",                            "NR", "NRU", "Nauruan"),
        c("Nepal",                            "NP", "NPL", "Nepali"),
        c("Netherlands",                      "NL", "NLD", "Dutch"),
        c("New Zealand",                      "NZ", "NZL", "New Zealander"),
        c("Nicaragua",                        "NI", "NIC", "Nicaraguan"),
        c("Niger",                            "NE", "NER", "Nigerien"),
        c("Nigeria",                          "NG", "NGA", "Nigerian"),
        c("North Korea",                      "KP", "PRK", "North Korean"),
        c("North Macedonia",                  "MK", "MKD", "Macedonian"),
        c("Norway",                           "NO", "NOR", "Norwegian"),
        c("Oman",                             "OM", "OMN", "Omani"),
        c("Pakistan",                         "PK", "PAK", "Pakistani"),
        c("Palau",                            "PW", "PLW", "Palauan"),
        c("Palestine",                        "PS", "PSE", "Palestinian"),
        c("Panama",                           "PA", "PAN", "Panamanian"),
        c("Papua New Guinea",                 "PG", "PNG", "Papua New Guinean"),
        c("Paraguay",                         "PY", "PRY", "Paraguayan"),
        c("Peru",                             "PE", "PER", "Peruvian"),
        c("Philippines",                      "PH", "PHL", "Filipino"),
        c("Poland",                           "PL", "POL", "Polish"),
        c("Portugal",                         "PT", "PRT", "Portuguese"),
        c("Qatar",                            "QA", "QAT", "Qatari"),
        c("Romania",                          "RO", "ROU", "Romanian"),
        c("Russia",                           "RU", "RUS", "Russian"),
        c("Rwanda",                           "RW", "RWA", "Rwandan"),
        c("Saint Kitts and Nevis",            "KN", "KNA", "Kittitian"),
        c("Saint Lucia",                      "LC", "LCA", "Saint Lucian"),
        c("Saint Vincent and the Grenadines", "VC", "VCT", "Vincentian"),
        c("Samoa",                            "WS", "WSM", "Samoan"),
        c("San Marino",                       "SM", "SMR", "Sammarinese"),
        c("São Tomé and Príncipe",            "ST", "STP", "São Toméan"),
        c("Saudi Arabia",                     "SA", "SAU", "Saudi"),
        c("Senegal",                          "SN", "SEN", "Senegalese"),
        c("Serbia",                           "RS", "SRB", "Serbian"),
        c("Seychelles",                       "SC", "SYC", "Seychellois"),
        c("Sierra Leone",                     "SL", "SLE", "Sierra Leonean"),
        c("Singapore",                        "SG", "SGP", "Singaporean"),
        c("Slovakia",                         "SK", "SVK", "Slovak"),
        c("Slovenia",                         "SI", "SVN", "Slovenian"),
        c("Solomon Islands",                  "SB", "SLB", "Solomon Islander"),
        c("Somalia",                          "SO", "SOM", "Somali"),
        c("South Africa",                     "ZA", "ZAF", "South African"),
        c("South Korea",                      "KR", "KOR", "South Korean"),
        c("South Sudan",                      "SS", "SSD", "South Sudanese"),
        c("Spain",                            "ES", "ESP", "Spanish"),
        c("Sri Lanka",                        "LK", "LKA", "Sri Lankan"),
        c("Sudan",                            "SD", "SDN", "Sudanese"),
        c("Suriname",                         "SR", "SUR", "Surinamese"),
        c("Sweden",                           "SE", "SWE", "Swedish"),
        c("Switzerland",                      "CH", "CHE", "Swiss"),
        c("Syria",                            "SY", "SYR", "Syrian"),
        c("Taiwan",                           "TW", "TWN", "Taiwanese"),
        c("Tajikistan",                       "TJ", "TJK", "Tajik"),
        c("Tanzania",                         "TZ", "TZA", "Tanzanian"),
        c("Thailand",                         "TH", "THA", "Thai"),
        c("Timor-Leste",                      "TL", "TLS", "East Timorese"),
        c("Togo",                             "TG", "TGO", "Togolese"),
        c("Tonga",                            "TO", "TON", "Tongan"),
        c("Trinidad and Tobago",              "TT", "TTO", "Trinidadian"),
        c("Tunisia",                          "TN", "TUN", "Tunisian"),
        c("Turkey",                           "TR", "TUR", "Turkish"),
        c("Turkmenistan",                     "TM", "TKM", "Turkmen"),
        c("Tuvalu",                           "TV", "TUV", "Tuvaluan"),
        c("Uganda",                           "UG", "UGA", "Ugandan"),
        c("Ukraine",                          "UA", "UKR", "Ukrainian"),
        c("United Arab Emirates",             "AE", "ARE", "Emirati"),
        c("United Kingdom",                   "GB", "GBR", "British"),
        c("United States",                    "US", "USA", "American"),
        c("Uruguay",                          "UY", "URY", "Uruguayan"),
        c("Uzbekistan",                       "UZ", "UZB", "Uzbekistani"),
        c("Vanuatu",                          "VU", "VUT", "Ni-Vanuatu"),
        c("Venezuela",                        "VE", "VEN", "Venezuelan"),
        c("Vietnam",                          "VN", "VNM", "Vietnamese"),
        c("Yemen",                            "YE", "YEM", "Yemeni"),
        c("Zambia",                           "ZM", "ZMB", "Zambian"),
        c("Zimbabwe",                         "ZW", "ZWE", "Zimbabwean")
    );

    private static final List<TaxonomyReferenceSeeder.LanguageSeed> LANGUAGES = List.of(
        new TaxonomyReferenceSeeder.LanguageSeed("en", "English",             1),
        new TaxonomyReferenceSeeder.LanguageSeed("fr", "French",              2),
        new TaxonomyReferenceSeeder.LanguageSeed("es", "Spanish",             3),
        new TaxonomyReferenceSeeder.LanguageSeed("ar", "Arabic",              4),
        new TaxonomyReferenceSeeder.LanguageSeed("pt", "Portuguese",          5),
        new TaxonomyReferenceSeeder.LanguageSeed("zh", "Chinese (Mandarin)",  6),
        new TaxonomyReferenceSeeder.LanguageSeed("hi", "Hindi",               7),
        new TaxonomyReferenceSeeder.LanguageSeed("de", "German",              8),
        new TaxonomyReferenceSeeder.LanguageSeed("ru", "Russian",             9),
        new TaxonomyReferenceSeeder.LanguageSeed("ja", "Japanese",           10),
        new TaxonomyReferenceSeeder.LanguageSeed("ko", "Korean",             11),
        new TaxonomyReferenceSeeder.LanguageSeed("it", "Italian",            12),
        new TaxonomyReferenceSeeder.LanguageSeed("tr", "Turkish",            13),
        new TaxonomyReferenceSeeder.LanguageSeed("pl", "Polish",             14),
        new TaxonomyReferenceSeeder.LanguageSeed("nl", "Dutch",              15),
        new TaxonomyReferenceSeeder.LanguageSeed("sv", "Swedish",            16),
        new TaxonomyReferenceSeeder.LanguageSeed("fa", "Persian (Farsi)",    17),
        new TaxonomyReferenceSeeder.LanguageSeed("uk", "Ukrainian",          18),
        new TaxonomyReferenceSeeder.LanguageSeed("ro", "Romanian",           19),
        new TaxonomyReferenceSeeder.LanguageSeed("vi", "Vietnamese",         20),
        new TaxonomyReferenceSeeder.LanguageSeed("am", "Amharic",            21),
        new TaxonomyReferenceSeeder.LanguageSeed("sw", "Swahili",            22),
        new TaxonomyReferenceSeeder.LanguageSeed("so", "Somali",             23),
        new TaxonomyReferenceSeeder.LanguageSeed("ha", "Hausa",              24),
        new TaxonomyReferenceSeeder.LanguageSeed("yo", "Yoruba",             25),
        new TaxonomyReferenceSeeder.LanguageSeed("ig", "Igbo",               26),
        new TaxonomyReferenceSeeder.LanguageSeed("bn", "Bengali",            27),
        new TaxonomyReferenceSeeder.LanguageSeed("ur", "Urdu",               28),
        new TaxonomyReferenceSeeder.LanguageSeed("tl", "Filipino (Tagalog)", 29),
        new TaxonomyReferenceSeeder.LanguageSeed("ti", "Tigrinya",           30)
    );

    private static TaxonomyReferenceSeeder.CommunitySeed comm(
            String originIso2, String destIso2, String name, String description) {
        String slug = originIso2.toLowerCase() + "-diaspora-in-" + destIso2.toLowerCase();
        return new TaxonomyReferenceSeeder.CommunitySeed(originIso2, destIso2, name, slug, description);
    }

    // Representative diaspora corridors for development / demo purposes.
    // ON CONFLICT DO NOTHING — safe to run on every boot; never overwrites admin data.
    private static final List<TaxonomyReferenceSeeder.CommunitySeed> DEV_COMMUNITIES = List.of(
        // Ethiopia
        comm("ET","GB","Ethiopian community in the UK",      "Ethiopians living and working in the United Kingdom"),
        comm("ET","US","Ethiopian community in the US",      "Ethiopians living and working in the United States"),
        comm("ET","DE","Ethiopian community in Germany",     "Ethiopians living and working in Germany"),
        comm("ET","CA","Ethiopian community in Canada",      "Ethiopians living and working in Canada"),
        comm("ET","AU","Ethiopian community in Australia",   "Ethiopians living and working in Australia"),
        comm("ET","SE","Ethiopian community in Sweden",      "Ethiopians living and working in Sweden"),
        // Nigeria
        comm("NG","GB","Nigerian community in the UK",       "Nigerians living and working in the United Kingdom"),
        comm("NG","US","Nigerian community in the US",       "Nigerians living and working in the United States"),
        comm("NG","CA","Nigerian community in Canada",       "Nigerians living and working in Canada"),
        comm("NG","DE","Nigerian community in Germany",      "Nigerians living and working in Germany"),
        comm("NG","IE","Nigerian community in Ireland",      "Nigerians living and working in Ireland"),
        // India
        comm("IN","GB","Indian community in the UK",         "Indians living and working in the United Kingdom"),
        comm("IN","US","Indian community in the US",         "Indians living and working in the United States"),
        comm("IN","CA","Indian community in Canada",         "Indians living and working in Canada"),
        comm("IN","AU","Indian community in Australia",      "Indians living and working in Australia"),
        comm("IN","AE","Indian community in the UAE",        "Indians living and working in the United Arab Emirates"),
        // Somalia
        comm("SO","GB","Somali community in the UK",         "Somalis living and working in the United Kingdom"),
        comm("SO","US","Somali community in the US",         "Somalis living and working in the United States"),
        comm("SO","NO","Somali community in Norway",         "Somalis living and working in Norway"),
        comm("SO","SE","Somali community in Sweden",         "Somalis living and working in Sweden"),
        comm("SO","CA","Somali community in Canada",         "Somalis living and working in Canada"),
        // Eritrea
        comm("ER","GB","Eritrean community in the UK",       "Eritreans living and working in the United Kingdom"),
        comm("ER","US","Eritrean community in the US",       "Eritreans living and working in the United States"),
        comm("ER","DE","Eritrean community in Germany",      "Eritreans living and working in Germany"),
        comm("ER","SE","Eritrean community in Sweden",       "Eritreans living and working in Sweden"),
        // Ghana
        comm("GH","GB","Ghanaian community in the UK",      "Ghanaians living and working in the United Kingdom"),
        comm("GH","US","Ghanaian community in the US",      "Ghanaians living and working in the United States"),
        comm("GH","DE","Ghanaian community in Germany",     "Ghanaians living and working in Germany"),
        comm("GH","IT","Ghanaian community in Italy",       "Ghanaians living and working in Italy"),
        // Kenya
        comm("KE","GB","Kenyan community in the UK",        "Kenyans living and working in the United Kingdom"),
        comm("KE","US","Kenyan community in the US",        "Kenyans living and working in the United States"),
        comm("KE","CA","Kenyan community in Canada",        "Kenyans living and working in Canada"),
        comm("KE","AU","Kenyan community in Australia",     "Kenyans living and working in Australia"),
        // Pakistan
        comm("PK","GB","Pakistani community in the UK",     "Pakistanis living and working in the United Kingdom"),
        comm("PK","US","Pakistani community in the US",     "Pakistanis living and working in the United States"),
        comm("PK","AE","Pakistani community in the UAE",    "Pakistanis living and working in the United Arab Emirates"),
        comm("PK","CA","Pakistani community in Canada",     "Pakistanis living and working in Canada"),
        // Philippines
        comm("PH","US","Filipino community in the US",      "Filipinos living and working in the United States"),
        comm("PH","AE","Filipino community in the UAE",     "Filipinos living and working in the United Arab Emirates"),
        comm("PH","GB","Filipino community in the UK",      "Filipinos living and working in the United Kingdom"),
        comm("PH","CA","Filipino community in Canada",      "Filipinos living and working in Canada"),
        comm("PH","AU","Filipino community in Australia",   "Filipinos living and working in Australia"),
        // Mexico
        comm("MX","US","Mexican community in the US",       "Mexicans living and working in the United States"),
        comm("MX","CA","Mexican community in Canada",       "Mexicans living and working in Canada"),
        // Brazil
        comm("BR","US","Brazilian community in the US",     "Brazilians living and working in the United States"),
        comm("BR","PT","Brazilian community in Portugal",   "Brazilians living and working in Portugal"),
        comm("BR","GB","Brazilian community in the UK",     "Brazilians living and working in the United Kingdom"),
        // Syria
        comm("SY","DE","Syrian community in Germany",       "Syrians living and working in Germany"),
        comm("SY","TR","Syrian community in Turkey",        "Syrians living and working in Turkey"),
        comm("SY","SE","Syrian community in Sweden",        "Syrians living and working in Sweden"),
        comm("SY","GB","Syrian community in the UK",        "Syrians living and working in the United Kingdom"),
        // China
        comm("CN","US","Chinese community in the US",       "Chinese living and working in the United States"),
        comm("CN","AU","Chinese community in Australia",    "Chinese living and working in Australia"),
        comm("CN","CA","Chinese community in Canada",       "Chinese living and working in Canada"),
        comm("CN","GB","Chinese community in the UK",       "Chinese living and working in the United Kingdom")
    );
}
