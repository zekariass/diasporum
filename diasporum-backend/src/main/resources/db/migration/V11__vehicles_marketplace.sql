-- Vehicles marketplace integration and query support (forward-only).
-- Canonical vehicle tables and catalogue records are owned by the v10.12 baseline.

ALTER TABLE media_objects
    DROP CONSTRAINT IF EXISTS media_objects_purpose_check;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
            WHERE conname = 'media_objects_purpose_check') THEN
        ALTER TABLE media_objects
            ADD CONSTRAINT media_objects_purpose_check
            CHECK (purpose IN (
                'AVATAR', 'FEED_IMAGE', 'FEED_VIDEO', 'BUSINESS', 'EVENT', 'JOB',
                'PROPERTY', 'MATCHMAKING_PROFILE_PHOTO',
                'MATCHMAKING_PROFILE_BLURRED', 'CHAT_ATTACHMENT',
                'SPARE_BAG_LISTING', 'DOCUMENT', 'OTHER', 'MESSAGE_AUDIO',
                'MESSAGE_IMAGE', 'MESSAGE_DOCUMENT', 'VEHICLE'
            ));
    END IF;
END $$;

-- The script configuration disables the surrounding transaction so PostgreSQL
-- commits the enum label before the partial index uses it. Idempotent statements
-- allow a safe retry if a later statement fails.
ALTER TYPE report_target_type ADD VALUE IF NOT EXISTS 'VEHICLE';

CREATE UNIQUE INDEX IF NOT EXISTS ux_vehicle_reports_open_reporter_target
    ON reports(reporter_id, target_id)
    WHERE status = 'OPEN' AND target_type = 'VEHICLE';

CREATE OR REPLACE TRIGGER trg_vehicle_listings_updated_at
    BEFORE UPDATE ON vehicle_listings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS ix_vehicle_listings_owner_cursor
    ON vehicle_listings(owner_user_id, created_at DESC, id DESC)
    WHERE owner_user_id IS NOT NULL AND status <> 'REMOVED';
CREATE INDEX IF NOT EXISTS ix_vehicle_listings_business_cursor
    ON vehicle_listings(business_account_id, created_at DESC, id DESC)
    WHERE business_account_id IS NOT NULL AND status <> 'REMOVED';
CREATE INDEX IF NOT EXISTS ix_vehicle_listings_newest_discovery
    ON vehicle_listings(published_at DESC, id DESC)
    WHERE status = 'PUBLISHED';
CREATE INDEX IF NOT EXISTS ix_vehicle_listings_price_asc_discovery
    ON vehicle_listings(currency_code, price_amount ASC, id ASC)
    WHERE status = 'PUBLISHED';
CREATE INDEX IF NOT EXISTS ix_vehicle_listings_price_desc_discovery
    ON vehicle_listings(currency_code, price_amount DESC, id DESC)
    WHERE status = 'PUBLISHED';
CREATE INDEX IF NOT EXISTS ix_vehicle_listing_communities_lookup
    ON vehicle_listing_communities(community_id, vehicle_listing_id);
CREATE INDEX IF NOT EXISTS ix_vehicle_listing_saves_cursor
    ON vehicle_listing_saves(user_id, created_at DESC, vehicle_listing_id DESC);

-- Vehicle catalogue reference data required by the vehicles marketplace.
-- The canonical tables ship empty in the v10.12 baseline; without rows here
-- catalogue validation rejects every listing and the feature is unusable.
-- All inserts are ON CONFLICT DO NOTHING so existing curation is preserved.

INSERT INTO vehicle_categories(category_key,display_name,sort_order) VALUES
    ('CAR','Car',10),
    ('MOTORCYCLE','Motorcycle',20),
    ('VAN','Van',30),
    ('PICKUP','Pickup truck',40),
    ('TRUCK','Truck',50),
    ('BUS','Bus',60),
    ('MOTORHOME','Motorhome',70),
    ('OTHER','Other',90)
ON CONFLICT DO NOTHING;

INSERT INTO vehicle_makes(make_key,display_name) VALUES
    ('TOYOTA','Toyota'),
    ('VOLKSWAGEN','Volkswagen'),
    ('MERCEDES_BENZ','Mercedes-Benz'),
    ('BMW','BMW'),
    ('AUDI','Audi'),
    ('FORD','Ford'),
    ('NISSAN','Nissan'),
    ('HONDA','Honda'),
    ('HYUNDAI','Hyundai'),
    ('KIA','Kia'),
    ('PEUGEOT','Peugeot'),
    ('RENAULT','Renault'),
    ('VOLVO','Volvo'),
    ('LAND_ROVER','Land Rover'),
    ('SUZUKI','Suzuki'),
    ('MAZDA','Mazda'),
    ('MITSUBISHI','Mitsubishi'),
    ('ISUZU','Isuzu'),
    ('CHEVROLET','Chevrolet'),
    ('JEEP','Jeep'),
    ('TESLA','Tesla'),
    ('FIAT','Fiat'),
    ('SKODA','Skoda'),
    ('OPEL','Opel'),
    ('SEAT','Seat'),
    ('LEXUS','Lexus')
ON CONFLICT DO NOTHING;

-- model_id is required on vehicle_listings: every make gets an OTHER model so
-- listings remain possible for models outside this curated set.
INSERT INTO vehicle_models(make_id,model_key,display_name)
SELECT m.id,v.model_key,v.display_name FROM vehicle_makes m
JOIN (VALUES
    ('TOYOTA','COROLLA','Corolla'),
    ('TOYOTA','CAMRY','Camry'),
    ('TOYOTA','RAV4','RAV4'),
    ('TOYOTA','LAND_CRUISER','Land Cruiser'),
    ('TOYOTA','HILUX','Hilux'),
    ('TOYOTA','YARIS','Yaris'),
    ('TOYOTA','HIACE','Hiace'),
    ('VOLKSWAGEN','GOLF','Golf'),
    ('VOLKSWAGEN','POLO','Polo'),
    ('VOLKSWAGEN','PASSAT','Passat'),
    ('VOLKSWAGEN','TIGUAN','Tiguan'),
    ('VOLKSWAGEN','TRANSPORTER','Transporter'),
    ('MERCEDES_BENZ','C_CLASS','C-Class'),
    ('MERCEDES_BENZ','E_CLASS','E-Class'),
    ('MERCEDES_BENZ','SPRINTER','Sprinter'),
    ('MERCEDES_BENZ','VITO','Vito'),
    ('MERCEDES_BENZ','G_CLASS','G-Class'),
    ('BMW','SERIES_3','3 Series'),
    ('BMW','SERIES_5','5 Series'),
    ('BMW','X3','X3'),
    ('BMW','X5','X5'),
    ('AUDI','A3','A3'),
    ('AUDI','A4','A4'),
    ('AUDI','Q5','Q5'),
    ('FORD','TRANSIT','Transit'),
    ('FORD','RANGER','Ranger'),
    ('FORD','FOCUS','Focus'),
    ('FORD','FIESTA','Fiesta'),
    ('NISSAN','PATROL','Patrol'),
    ('NISSAN','NAVARA','Navara'),
    ('NISSAN','QASHQAI','Qashqai'),
    ('NISSAN','SUNNY','Sunny'),
    ('HONDA','CIVIC','Civic'),
    ('HONDA','CR_V','CR-V'),
    ('HONDA','ACCORD','Accord'),
    ('HYUNDAI','TUCSON','Tucson'),
    ('HYUNDAI','SANTA_FE','Santa Fe'),
    ('HYUNDAI','ELANTRA','Elantra'),
    ('HYUNDAI','H1','H-1'),
    ('KIA','SPORTAGE','Sportage'),
    ('KIA','SORENTO','Sorento'),
    ('KIA','RIO','Rio'),
    ('PEUGEOT','P208','208'),
    ('PEUGEOT','P3008','3008'),
    ('PEUGEOT','PARTNER','Partner'),
    ('RENAULT','CLIO','Clio'),
    ('RENAULT','MEGANE','Megane'),
    ('RENAULT','KANGOO','Kangoo'),
    ('VOLVO','XC60','XC60'),
    ('VOLVO','XC90','XC90'),
    ('LAND_ROVER','DEFENDER','Defender'),
    ('LAND_ROVER','DISCOVERY','Discovery'),
    ('LAND_ROVER','RANGE_ROVER','Range Rover'),
    ('SUZUKI','VITARA','Vitara'),
    ('SUZUKI','JIMNY','Jimny'),
    ('SUZUKI','SWIFT','Swift'),
    ('MAZDA','CX_5','CX-5'),
    ('MAZDA','MAZDA3','Mazda3'),
    ('MITSUBISHI','PAJERO','Pajero'),
    ('MITSUBISHI','L200','L200'),
    ('ISUZU','D_MAX','D-Max'),
    ('ISUZU','N_SERIES','N-Series'),
    ('CHEVROLET','SPARK','Spark'),
    ('CHEVROLET','TRAILBLAZER','Trailblazer'),
    ('JEEP','WRANGLER','Wrangler'),
    ('JEEP','GRAND_CHEROKEE','Grand Cherokee'),
    ('TESLA','MODEL_3','Model 3'),
    ('TESLA','MODEL_Y','Model Y'),
    ('FIAT','DUCATO','Ducato'),
    ('FIAT','FIAT_500','500'),
    ('SKODA','OCTAVIA','Octavia'),
    ('SKODA','SUPERB','Superb'),
    ('OPEL','CORSA','Corsa'),
    ('OPEL','ASTRA','Astra'),
    ('SEAT','IBIZA','Ibiza'),
    ('SEAT','LEON','Leon'),
    ('LEXUS','LX','LX'),
    ('LEXUS','RX','RX'),
    ('LEXUS','GX','GX')
) AS v(make_key,model_key,display_name) ON v.make_key=m.make_key
ON CONFLICT DO NOTHING;

INSERT INTO vehicle_models(make_id,model_key,display_name)
SELECT m.id,'OTHER','Other' FROM vehicle_makes m
ON CONFLICT DO NOTHING;

INSERT INTO vehicle_features(feature_key,display_name,sort_order) VALUES
    ('AIR_CONDITIONING','Air conditioning',10),
    ('CLIMATE_CONTROL','Climate control',20),
    ('BLUETOOTH','Bluetooth',30),
    ('BACKUP_CAMERA','Backup camera',40),
    ('NAVIGATION_SYSTEM','Navigation system',50),
    ('CRUISE_CONTROL','Cruise control',60),
    ('PARKING_SENSORS','Parking sensors',70),
    ('HEATED_SEATS','Heated seats',80),
    ('SUNROOF','Sunroof',90),
    ('ALLOY_WHEELS','Alloy wheels',100),
    ('ABS','ABS',110),
    ('APPLE_CARPLAY','Apple CarPlay',120),
    ('ANDROID_AUTO','Android Auto',130),
    ('THIRD_ROW_SEATS','Third-row seats',140),
    ('TOW_PACKAGE','Tow package',150)
ON CONFLICT DO NOTHING;
