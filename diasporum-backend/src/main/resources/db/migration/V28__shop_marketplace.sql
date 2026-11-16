-- V28: Global Shop Marketplace (v10.13 design candidate) as an additive migration.
--
-- Source of truth: Diasporum_v10.13/Diasporum_PostgreSQL_Schema_v10_13.sql, section
-- "v10.13 GLOBAL SHOP MARKETPLACE". The 74 marketplace tables, triggers and invariants
-- below are copied verbatim from that section. The v10.13 clean-install script was NOT
-- executed; only the marketplace delta is applied on top of the V1..V27 history.
--
-- Shared-contract extensions (data model section 18):
--   1. notification_type: marketplace order/shipment/return/payout/account/low-stock types.
--   2. report_target_type: SHOP, PRODUCT, PRODUCT_REVIEW, SHOP_REVIEW.
--   3. content_reference_type: SHOP, PRODUCT (no placement rules are enabled here;
--      featured marketplace placements remain a separate approved configuration).
--   4. media_objects.purpose: SHOP, PRODUCT.
--   5. direct_conversations.context_type: SHOP, SHOP_PRODUCT, SHOP_ORDER.
-- New enum labels are not used anywhere in this script, so the migration stays transactional.

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'MARKETPLACE_ORDER_UPDATE';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'MARKETPLACE_SHIPMENT_UPDATE';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'MARKETPLACE_RETURN_UPDATE';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'MARKETPLACE_PAYOUT_UPDATE';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'MARKETPLACE_ACCOUNT_ACTION_REQUIRED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'MARKETPLACE_LOW_STOCK';

ALTER TYPE report_target_type ADD VALUE IF NOT EXISTS 'SHOP';
ALTER TYPE report_target_type ADD VALUE IF NOT EXISTS 'PRODUCT';
ALTER TYPE report_target_type ADD VALUE IF NOT EXISTS 'PRODUCT_REVIEW';
ALTER TYPE report_target_type ADD VALUE IF NOT EXISTS 'SHOP_REVIEW';

ALTER TYPE content_reference_type ADD VALUE IF NOT EXISTS 'SHOP';
ALTER TYPE content_reference_type ADD VALUE IF NOT EXISTS 'PRODUCT';

ALTER TABLE media_objects DROP CONSTRAINT IF EXISTS media_objects_purpose_check;
ALTER TABLE media_objects ADD CONSTRAINT media_objects_purpose_check
    CHECK (purpose IN (
        'AVATAR', 'FEED_IMAGE', 'FEED_VIDEO', 'FEED_AUDIO', 'BUSINESS',
        'EVENT', 'JOB', 'PROPERTY', 'MATCHMAKING_PROFILE_PHOTO',
        'MATCHMAKING_PROFILE_BLURRED', 'CHAT_ATTACHMENT',
        'SPARE_BAG_LISTING', 'DOCUMENT', 'OTHER', 'MESSAGE_AUDIO',
        'MESSAGE_IMAGE', 'MESSAGE_DOCUMENT', 'VEHICLE', 'SERVICE_REQUEST',
        'SHOP', 'PRODUCT'
    ));

DO $$
DECLARE v_name text;
BEGIN
    FOR v_name IN
        SELECT conname FROM pg_constraint
         WHERE conrelid='direct_conversations'::regclass AND contype='c'
           AND pg_get_constraintdef(oid) LIKE '%context_type = ANY%'
    LOOP
        EXECUTE format('ALTER TABLE direct_conversations DROP CONSTRAINT %I', v_name);
    END LOOP;
END $$;
ALTER TABLE direct_conversations ADD CONSTRAINT direct_conversations_context_type_check
    CHECK (context_type IN ('GENERAL','PROPERTY_LISTING','VEHICLE_LISTING','BUSINESS_PROFILE',
        'EVENT','JOB_LISTING','SPARE_BAG_CONTACT','SERVICE_REQUEST','COMMUNITY_HELP_POST',
        'SHOP','SHOP_PRODUCT','SHOP_ORDER'));
COMMENT ON COLUMN direct_conversations.context_type IS 'GENERAL, PROPERTY_LISTING, VEHICLE_LISTING, BUSINESS_PROFILE, EVENT, JOB_LISTING, SPARE_BAG_CONTACT, SERVICE_REQUEST, COMMUNITY_HELP_POST, SHOP, SHOP_PRODUCT or SHOP_ORDER. Matchmaking uses GENERAL.';

-- =============================================================================
-- v10.13 GLOBAL SHOP MARKETPLACE (physical-goods commerce)
-- =============================================================================
-- This section is additive to the v10.12 clean-install baseline. It deliberately
-- reuses users, business_accounts/business_account_members, countries, addresses,
-- media_objects, billing entitlements, featured_items, reports/moderation_actions,
-- audit_logs, notifications, direct_conversations, idempotency_keys and outbox_events.
-- Commerce orders/payments are NOT subscription billing_orders/billing_payments.
-- This is a schema candidate; execute on a disposable clean PostgreSQL/PostGIS DB
-- and complete the application/provider integration tests before operational use.

-- A market can be browsable before it is enabled for checkout or seller onboarding.
CREATE TABLE marketplace_country_settings (
    country_id uuid PRIMARY KEY REFERENCES countries(id) ON DELETE RESTRICT,
    market_status text NOT NULL DEFAULT 'DISABLED' CHECK (market_status IN ('DISABLED','BROWSING_ONLY','ACTIVE','SUSPENDED')),
    buyer_checkout_enabled boolean NOT NULL DEFAULT false,
    seller_onboarding_enabled boolean NOT NULL DEFAULT false,
    shipping_enabled boolean NOT NULL DEFAULT false,
    tax_enabled boolean NOT NULL DEFAULT false,
    default_currency char(3) CHECK (default_currency IS NULL OR default_currency ~ '^[A-Z]{3}$'),
    supported_currencies text[] NOT NULL DEFAULT ARRAY[]::text[],
    readiness_config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(readiness_config)='object'),
    enabled_at timestamptz,
    disabled_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (NOT buyer_checkout_enabled OR (market_status='ACTIVE' AND shipping_enabled AND tax_enabled)),
    CHECK (NOT seller_onboarding_enabled OR market_status='ACTIVE'),
    CHECK (default_currency IS NULL OR default_currency::text = ANY(supported_currencies)),
    CHECK (array_position(supported_currencies, NULL) IS NULL)
);

-- A legal/payment seller can be an individual Diasporum user or a Business Account.
CREATE TABLE marketplace_sellers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_type text NOT NULL CHECK (seller_type IN ('INDIVIDUAL','BUSINESS')),
    owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    business_account_id uuid REFERENCES business_accounts(id) ON DELETE RESTRICT,
    legal_country_id uuid NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    legal_name text NOT NULL CHECK (length(trim(legal_name)) BETWEEN 1 AND 240),
    display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 180),
    status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','ACTIVE','RESTRICTED','SUSPENDED','CLOSED','REJECTED')),
    verification_status text NOT NULL DEFAULT 'NOT_STARTED' CHECK (verification_status IN ('NOT_STARTED','PENDING','VERIFIED','REJECTED','RESTRICTED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz,
    CHECK ((seller_type='INDIVIDUAL' AND owner_user_id IS NOT NULL AND business_account_id IS NULL)
        OR (seller_type='BUSINESS' AND owner_user_id IS NULL AND business_account_id IS NOT NULL)),
    CHECK ((status='CLOSED') = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX ux_marketplace_sellers_individual ON marketplace_sellers(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX ux_marketplace_sellers_business ON marketplace_sellers(business_account_id) WHERE business_account_id IS NOT NULL;
CREATE INDEX ix_marketplace_sellers_country_status ON marketplace_sellers(legal_country_id,status);

-- One connected account per legal seller/payment entity, not one per shop.
CREATE TABLE seller_payment_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id uuid NOT NULL REFERENCES marketplace_sellers(id) ON DELETE RESTRICT,
    provider_key text NOT NULL CHECK (provider_key=upper(trim(provider_key)) AND provider_key ~ '^[A-Z][A-Z0-9_]*$'),
    connected_account_id text NOT NULL,
    account_country_id uuid REFERENCES countries(id) ON DELETE RESTRICT,
    account_type text NOT NULL CHECK (account_type IN ('EXPRESS','STANDARD','CUSTOM','OTHER')),
    onboarding_status text NOT NULL DEFAULT 'NOT_STARTED' CHECK (onboarding_status IN ('NOT_STARTED','PENDING','RESTRICTED','COMPLETE','REJECTED')),
    charges_enabled boolean NOT NULL DEFAULT false,
    payouts_enabled boolean NOT NULL DEFAULT false,
    details_submitted boolean NOT NULL DEFAULT false,
    requirements_due jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(requirements_due)='array'),
    provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provider_metadata)='object'),
    last_synced_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(seller_id,provider_key),
    UNIQUE(provider_key,connected_account_id)
);
CREATE INDEX ix_seller_payment_accounts_status ON seller_payment_accounts(onboarding_status,payouts_enabled);

CREATE TABLE shops (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id uuid NOT NULL REFERENCES marketplace_sellers(id) ON DELETE RESTRICT,
    primary_market_country_id uuid NOT NULL REFERENCES marketplace_country_settings(country_id) ON DELETE RESTRICT,
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
    slug text NOT NULL CHECK (slug=lower(trim(slug)) AND slug ~ '^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$'),
    description text CHECK (description IS NULL OR length(description)<=5000),
    status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_REVIEW','ACTIVE','PAUSED','RESTRICTED','SUSPENDED','CLOSED','REJECTED')),
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz,
    UNIQUE(primary_market_country_id,slug),
    CHECK ((status='CLOSED') = (closed_at IS NOT NULL))
);
CREATE INDEX ix_shops_seller_status ON shops(seller_id,status,created_at DESC);
CREATE INDEX ix_shops_market_status ON shops(primary_market_country_id,status,created_at DESC);

CREATE TABLE shop_policies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
    policy_type text NOT NULL CHECK (policy_type IN ('SHIPPING','RETURNS','CANCELLATION','REFUNDS','TERMS','PRIVACY')),
    version_number integer NOT NULL CHECK (version_number>0),
    policy_text text NOT NULL CHECK (length(trim(policy_text)) BETWEEN 1 AND 20000),
    effective_from timestamptz NOT NULL DEFAULT now(),
    effective_until timestamptz,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(shop_id,policy_type,version_number),
    CHECK (effective_until IS NULL OR effective_until>effective_from)
);
CREATE INDEX ix_shop_policies_current ON shop_policies(shop_id,policy_type,effective_from DESC);

CREATE TABLE shop_shipping_profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
    profile_name text NOT NULL CHECK (length(trim(profile_name)) BETWEEN 1 AND 120),
    origin_address_id uuid NOT NULL REFERENCES addresses(id) ON DELETE RESTRICT,
    handling_time_min_days integer NOT NULL DEFAULT 0 CHECK (handling_time_min_days>=0),
    handling_time_max_days integer NOT NULL DEFAULT 2 CHECK (handling_time_max_days>=handling_time_min_days),
    default_package_weight_grams integer CHECK (default_package_weight_grams IS NULL OR default_package_weight_grams>0),
    default_package_length_mm integer CHECK (default_package_length_mm IS NULL OR default_package_length_mm>0),
    default_package_width_mm integer CHECK (default_package_width_mm IS NULL OR default_package_width_mm>0),
    default_package_height_mm integer CHECK (default_package_height_mm IS NULL OR default_package_height_mm>0),
    provider_account_reference text,
    is_default boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(shop_id,profile_name)
);
CREATE UNIQUE INDEX ux_shop_shipping_profile_default ON shop_shipping_profiles(shop_id) WHERE is_default=true AND status='ACTIVE';

CREATE TABLE shop_media (
    shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    media_role text NOT NULL CHECK (media_role IN ('LOGO','COVER','GALLERY')),
    display_order integer NOT NULL DEFAULT 0 CHECK (display_order>=0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(shop_id,media_id)
);
CREATE UNIQUE INDEX ux_shop_media_single_logo ON shop_media(shop_id) WHERE media_role='LOGO';
CREATE UNIQUE INDEX ux_shop_media_single_cover ON shop_media(shop_id) WHERE media_role='COVER';

-- Global product taxonomy; separate from all existing Diasporum category systems.
CREATE TABLE product_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id uuid REFERENCES product_categories(id) ON DELETE RESTRICT,
    category_key text NOT NULL UNIQUE CHECK (category_key=lower(trim(category_key)) AND category_key ~ '^[a-z0-9]+([_-][a-z0-9]+)*$'),
    provider_tax_category_key text,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (parent_id IS NULL OR parent_id<>id)
);
CREATE INDEX ix_product_categories_parent_sort ON product_categories(parent_id,is_active,sort_order);

CREATE TABLE product_category_translations (
    category_id uuid NOT NULL REFERENCES product_categories(id) ON DELETE CASCADE,
    language_code text NOT NULL CHECK (language_code=lower(trim(language_code)) AND length(language_code) BETWEEN 2 AND 12),
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
    description text CHECK (description IS NULL OR length(description)<=2000),
    PRIMARY KEY(category_id,language_code)
);

CREATE TABLE product_attribute_definitions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id uuid NOT NULL REFERENCES product_categories(id) ON DELETE CASCADE,
    attribute_key text NOT NULL CHECK (attribute_key=lower(trim(attribute_key)) AND attribute_key ~ '^[a-z][a-z0-9_]*$'),
    display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 120),
    data_type text NOT NULL CHECK (data_type IN ('TEXT','NUMBER','BOOLEAN','ENUM','DATE')),
    is_required boolean NOT NULL DEFAULT false,
    is_filterable boolean NOT NULL DEFAULT false,
    is_variant_level boolean NOT NULL DEFAULT false,
    validation_config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation_config)='object'),
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    UNIQUE(category_id,attribute_key)
);
CREATE INDEX ix_product_attribute_definitions_category ON product_attribute_definitions(category_id,is_active,sort_order);

CREATE TABLE product_attribute_options (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attribute_definition_id uuid NOT NULL REFERENCES product_attribute_definitions(id) ON DELETE CASCADE,
    option_key text NOT NULL CHECK (option_key=lower(trim(option_key))),
    display_value text NOT NULL CHECK (length(trim(display_value)) BETWEEN 1 AND 160),
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    UNIQUE(attribute_definition_id,option_key)
);

CREATE TABLE products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
    category_id uuid NOT NULL REFERENCES product_categories(id) ON DELETE RESTRICT,
    name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 240),
    slug text NOT NULL CHECK (slug=lower(trim(slug)) AND slug ~ '^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$'),
    description text CHECK (description IS NULL OR length(description)<=20000),
    brand text CHECK (brand IS NULL OR length(brand)<=160),
    condition text NOT NULL DEFAULT 'NEW' CHECK (condition IN ('NEW','LIKE_NEW','USED_GOOD','USED_FAIR','REFURBISHED','OTHER')),
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes)='object'),
    status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_REVIEW','PUBLISHED','PAUSED','OUT_OF_STOCK','ARCHIVED','REMOVED','REJECTED')),
    moderation_required boolean NOT NULL DEFAULT true,
    published_at timestamptz,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    UNIQUE(shop_id,slug)
);
CREATE INDEX ix_products_shop_status ON products(shop_id,status,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_products_category_status ON products(category_id,status,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_products_attributes_gin ON products USING gin(attributes);
CREATE INDEX ix_products_search ON products USING gin(to_tsvector('english',coalesce(name,'') || ' ' || coalesce(description,''))) WHERE deleted_at IS NULL;

CREATE TABLE product_market_availability (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    country_id uuid NOT NULL REFERENCES marketplace_country_settings(country_id) ON DELETE RESTRICT,
    availability_status text NOT NULL DEFAULT 'ENABLED' CHECK (availability_status IN ('ENABLED','RESTRICTED','DISABLED')),
    reason text,
    effective_from timestamptz NOT NULL DEFAULT now(),
    effective_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(product_id,country_id),
    CHECK (effective_until IS NULL OR effective_until>effective_from)
);
CREATE INDEX ix_product_market_availability_country ON product_market_availability(country_id,availability_status,product_id);

CREATE TABLE product_variants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    seller_id uuid NOT NULL REFERENCES marketplace_sellers(id) ON DELETE RESTRICT,
    seller_sku text,
    barcode text,
    variant_label text NOT NULL DEFAULT 'Default' CHECK (length(trim(variant_label)) BETWEEN 1 AND 240),
    weight_grams integer CHECK (weight_grams IS NULL OR weight_grams>0),
    length_mm integer CHECK (length_mm IS NULL OR length_mm>0),
    width_mm integer CHECK (width_mm IS NULL OR width_mm>0),
    height_mm integer CHECK (height_mm IS NULL OR height_mm>0),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','ARCHIVED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (seller_sku IS NULL OR length(trim(seller_sku)) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX ux_product_variants_seller_sku ON product_variants(seller_id,lower(seller_sku)) WHERE seller_sku IS NOT NULL;
CREATE INDEX ix_product_variants_product_status ON product_variants(product_id,status);

CREATE TABLE product_variant_attribute_values (
    variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    attribute_definition_id uuid NOT NULL REFERENCES product_attribute_definitions(id) ON DELETE RESTRICT,
    option_id uuid REFERENCES product_attribute_options(id) ON DELETE RESTRICT,
    value_text text,
    value_number numeric(18,6),
    value_boolean boolean,
    value_date date,
    PRIMARY KEY(variant_id,attribute_definition_id),
    CHECK (num_nonnulls(option_id,value_text,value_number,value_boolean,value_date)=1)
);

CREATE TABLE product_variant_prices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    market_country_id uuid NOT NULL REFERENCES marketplace_country_settings(country_id) ON DELETE RESTRICT,
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    amount_minor bigint NOT NULL CHECK (amount_minor>=0),
    compare_at_amount_minor bigint CHECK (compare_at_amount_minor IS NULL OR compare_at_amount_minor>=amount_minor),
    effective_from timestamptz NOT NULL DEFAULT now(),
    effective_until timestamptz,
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (effective_until IS NULL OR effective_until>effective_from),
    UNIQUE(variant_id,market_country_id,currency_code,effective_from)
);
CREATE INDEX ix_product_variant_prices_lookup ON product_variant_prices(variant_id,market_country_id,currency_code,status,effective_from DESC);

CREATE TABLE product_media (
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    media_role text NOT NULL DEFAULT 'IMAGE' CHECK (media_role IN ('IMAGE','VIDEO','DOCUMENT')),
    display_order integer NOT NULL DEFAULT 0 CHECK (display_order>=0),
    alt_text text CHECK (alt_text IS NULL OR length(alt_text)<=500),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(product_id,media_id)
);
CREATE UNIQUE INDEX ux_product_media_single_primary ON product_media(product_id) WHERE display_order=0;

CREATE TABLE product_tags (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_key text NOT NULL UNIQUE CHECK (tag_key=lower(trim(tag_key)) AND length(tag_key) BETWEEN 2 AND 50),
    display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 2 AND 50),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE product_tag_assignments (
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    tag_id uuid NOT NULL REFERENCES product_tags(id) ON DELETE RESTRICT,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(product_id,tag_id)
);
CREATE INDEX ix_product_tag_assignments_tag ON product_tag_assignments(tag_id,product_id);

-- Inventory is seller-owned and tracked per variant/location.
CREATE TABLE inventory_locations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
    address_id uuid NOT NULL REFERENCES addresses(id) ON DELETE RESTRICT,
    location_name text NOT NULL CHECK (length(trim(location_name)) BETWEEN 1 AND 160),
    location_type text NOT NULL DEFAULT 'STOCK' CHECK (location_type IN ('STOCK','DISPATCH','BOTH')),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(shop_id,location_name)
);
CREATE INDEX ix_inventory_locations_shop ON inventory_locations(shop_id,status);

CREATE TABLE inventory_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_location_id uuid NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    quantity_on_hand integer NOT NULL DEFAULT 0 CHECK (quantity_on_hand>=0),
    low_stock_threshold integer NOT NULL DEFAULT 0 CHECK (low_stock_threshold>=0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(inventory_location_id,variant_id)
);
CREATE INDEX ix_inventory_items_variant ON inventory_items(variant_id);

CREATE TABLE shopping_carts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ABANDONED','CONVERTED','EXPIRED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    converted_at timestamptz
);
CREATE UNIQUE INDEX ux_shopping_carts_user_currency_active ON shopping_carts(user_id,currency_code) WHERE status='ACTIVE';
CREATE INDEX ix_shopping_carts_user_recent ON shopping_carts(user_id,updated_at DESC);

CREATE TABLE shopping_cart_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id uuid NOT NULL REFERENCES shopping_carts(id) ON DELETE CASCADE,
    variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    quantity integer NOT NULL CHECK (quantity>0),
    added_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(cart_id,variant_id)
);
CREATE INDEX ix_shopping_cart_items_cart ON shopping_cart_items(cart_id,added_at);

CREATE TABLE wishlists (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL DEFAULT 'My Wishlist' CHECK (length(trim(name)) BETWEEN 1 AND 120),
    visibility text NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE','SHARE_LINK')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_wishlists_user ON wishlists(user_id,created_at DESC);
CREATE TABLE wishlist_items (
    wishlist_id uuid NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(wishlist_id,product_id)
);

CREATE TABLE checkout_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    cart_id uuid REFERENCES shopping_carts(id) ON DELETE SET NULL,
    market_country_id uuid NOT NULL REFERENCES marketplace_country_settings(country_id) ON DELETE RESTRICT,
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    subtotal_amount_minor bigint NOT NULL DEFAULT 0 CHECK (subtotal_amount_minor>=0),
    shipping_amount_minor bigint NOT NULL DEFAULT 0 CHECK (shipping_amount_minor>=0),
    discount_amount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_amount_minor>=0),
    tax_amount_minor bigint NOT NULL DEFAULT 0 CHECK (tax_amount_minor>=0),
    total_amount_minor bigint NOT NULL DEFAULT 0 CHECK (total_amount_minor>=0),
    status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','QUOTED','PAYMENT_PENDING','PLACED','PAYMENT_FAILED','EXPIRED','CANCELLED')),
    quoted_at timestamptz,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (discount_amount_minor<=subtotal_amount_minor),
    CHECK (total_amount_minor=subtotal_amount_minor+shipping_amount_minor-discount_amount_minor+tax_amount_minor)
);
CREATE INDEX ix_checkout_sessions_user_recent ON checkout_sessions(user_id,created_at DESC);
CREATE INDEX ix_checkout_sessions_expiry ON checkout_sessions(expires_at) WHERE status IN ('OPEN','QUOTED','PAYMENT_PENDING');

CREATE TABLE checkout_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    checkout_session_id uuid NOT NULL REFERENCES checkout_sessions(id) ON DELETE RESTRICT,
    seller_id uuid NOT NULL REFERENCES marketplace_sellers(id) ON DELETE RESTRICT,
    shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
    product_id uuid REFERENCES products(id) ON DELETE SET NULL,
    variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
    product_name_snapshot text NOT NULL,
    variant_label_snapshot text NOT NULL,
    seller_sku_snapshot text,
    quantity integer NOT NULL CHECK (quantity>0),
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    unit_price_minor bigint NOT NULL CHECK (unit_price_minor>=0),
    discount_amount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_amount_minor>=0),
    tax_amount_minor bigint NOT NULL DEFAULT 0 CHECK (tax_amount_minor>=0),
    line_total_minor bigint NOT NULL CHECK (line_total_minor>=0),
    attributes_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes_snapshot)='object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (discount_amount_minor<=unit_price_minor*quantity),
    CHECK (line_total_minor=unit_price_minor*quantity-discount_amount_minor+tax_amount_minor)
);
CREATE INDEX ix_checkout_items_session ON checkout_items(checkout_session_id,seller_id,shop_id);

CREATE TABLE shipping_zones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
    zone_name text NOT NULL CHECK (length(trim(zone_name)) BETWEEN 1 AND 120),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(shop_id,zone_name)
);
CREATE TABLE shipping_zone_countries (
    shipping_zone_id uuid NOT NULL REFERENCES shipping_zones(id) ON DELETE CASCADE,
    country_id uuid NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    PRIMARY KEY(shipping_zone_id,country_id)
);
CREATE INDEX ix_shipping_zone_countries_country ON shipping_zone_countries(country_id,shipping_zone_id);

CREATE TABLE shipping_methods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
    shipping_zone_id uuid NOT NULL REFERENCES shipping_zones(id) ON DELETE RESTRICT,
    method_name text NOT NULL CHECK (length(trim(method_name)) BETWEEN 1 AND 120),
    method_type text NOT NULL CHECK (method_type IN ('FLAT_RATE','WEIGHT_BASED','FREE','FREE_ABOVE_THRESHOLD','SHIPPO_CALCULATED','EXTERNAL_CARRIER')),
    currency_code char(3) CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(shop_id,shipping_zone_id,method_name)
);
CREATE INDEX ix_shipping_methods_zone_status ON shipping_methods(shipping_zone_id,status);

CREATE TABLE shipping_method_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shipping_method_id uuid NOT NULL REFERENCES shipping_methods(id) ON DELETE CASCADE,
    rule_type text NOT NULL CHECK (rule_type IN ('BASE_RATE','PER_WEIGHT','FREE_ABOVE_AMOUNT','MAX_WEIGHT','PRODUCT_OVERRIDE')),
    minimum_order_amount_minor bigint CHECK (minimum_order_amount_minor IS NULL OR minimum_order_amount_minor>=0),
    maximum_weight_grams integer CHECK (maximum_weight_grams IS NULL OR maximum_weight_grams>0),
    rate_amount_minor bigint CHECK (rate_amount_minor IS NULL OR rate_amount_minor>=0),
    conditions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(conditions)='object'),
    priority integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_shipping_method_rules_method_priority ON shipping_method_rules(shipping_method_id,priority DESC);

CREATE TABLE shipping_rate_quotes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    checkout_session_id uuid NOT NULL REFERENCES checkout_sessions(id) ON DELETE CASCADE,
    seller_id uuid NOT NULL REFERENCES marketplace_sellers(id) ON DELETE RESTRICT,
    shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
    shipping_method_id uuid REFERENCES shipping_methods(id) ON DELETE SET NULL,
    provider_key text,
    provider_rate_id text,
    service_name text,
    amount_minor bigint NOT NULL CHECK (amount_minor>=0),
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    estimated_min_days integer CHECK (estimated_min_days IS NULL OR estimated_min_days>=0),
    estimated_max_days integer CHECK (estimated_max_days IS NULL OR estimated_max_days>=estimated_min_days),
    quote_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(quote_payload)='object'),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_shipping_rate_quotes_checkout ON shipping_rate_quotes(checkout_session_id,shop_id,expires_at);

CREATE TABLE inventory_reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    checkout_session_id uuid NOT NULL REFERENCES checkout_sessions(id) ON DELETE RESTRICT,
    checkout_item_id uuid NOT NULL REFERENCES checkout_items(id) ON DELETE RESTRICT,
    inventory_item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    quantity integer NOT NULL CHECK (quantity>0),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CONFIRMED','RELEASED','EXPIRED')),
    expires_at timestamptz NOT NULL,
    confirmed_at timestamptz,
    released_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(checkout_item_id,inventory_item_id),
    CHECK (expires_at>created_at)
);
CREATE INDEX ix_inventory_reservations_active ON inventory_reservations(inventory_item_id,expires_at) WHERE status='ACTIVE';
CREATE INDEX ix_inventory_reservations_checkout ON inventory_reservations(checkout_session_id,status);

CREATE TABLE inventory_movements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    movement_type text NOT NULL CHECK (movement_type IN ('RECEIPT','SALE','RESERVATION_CONFIRMATION','RETURN_RESTOCK','ADJUSTMENT','DAMAGE','WRITE_OFF','TRANSFER')),
    quantity_delta integer NOT NULL CHECK (quantity_delta<>0),
    reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
    source_type text,
    source_id uuid,
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_inventory_movements_item_time ON inventory_movements(inventory_item_id,created_at DESC);

-- Order creation is pending-payment first; a verified provider webhook moves it to PLACED.
CREATE TABLE orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number text NOT NULL UNIQUE,
    checkout_session_id uuid NOT NULL UNIQUE REFERENCES checkout_sessions(id) ON DELETE RESTRICT,
    customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    market_country_id uuid NOT NULL REFERENCES marketplace_country_settings(country_id) ON DELETE RESTRICT,
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    subtotal_amount_minor bigint NOT NULL CHECK (subtotal_amount_minor>=0),
    shipping_amount_minor bigint NOT NULL CHECK (shipping_amount_minor>=0),
    discount_amount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_amount_minor>=0),
    tax_amount_minor bigint NOT NULL DEFAULT 0 CHECK (tax_amount_minor>=0),
    total_amount_minor bigint NOT NULL CHECK (total_amount_minor>=0),
    status text NOT NULL DEFAULT 'PAYMENT_PENDING' CHECK (status IN ('PAYMENT_PENDING','PLACED','PARTIALLY_FULFILLED','FULFILLED','CANCEL_REQUESTED','CANCELLED','PARTIALLY_RETURNED','RETURNED','PARTIALLY_REFUNDED','REFUNDED','PAYMENT_FAILED')),
    placed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (total_amount_minor=subtotal_amount_minor+shipping_amount_minor-discount_amount_minor+tax_amount_minor)
);
CREATE INDEX ix_orders_customer_recent ON orders(customer_user_id,created_at DESC);
CREATE INDEX ix_orders_status_recent ON orders(status,created_at DESC);

CREATE TABLE seller_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    seller_id uuid NOT NULL REFERENCES marketplace_sellers(id) ON DELETE RESTRICT,
    shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
    seller_order_number text NOT NULL UNIQUE,
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    subtotal_amount_minor bigint NOT NULL CHECK (subtotal_amount_minor>=0),
    shipping_amount_minor bigint NOT NULL DEFAULT 0 CHECK (shipping_amount_minor>=0),
    discount_amount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_amount_minor>=0),
    tax_amount_minor bigint NOT NULL DEFAULT 0 CHECK (tax_amount_minor>=0),
    commission_amount_minor bigint NOT NULL DEFAULT 0 CHECK (commission_amount_minor>=0),
    seller_net_amount_minor bigint NOT NULL CHECK (seller_net_amount_minor>=0),
    status text NOT NULL DEFAULT 'PAYMENT_PENDING' CHECK (status IN ('PAYMENT_PENDING','PLACED','ACCEPTED','PROCESSING','PARTIALLY_DISPATCHED','DISPATCHED','DELIVERED','CANCEL_REQUESTED','CANCELLED','RETURN_REQUESTED','PARTIALLY_RETURNED','RETURNED','PARTIALLY_REFUNDED','REFUNDED')),
    shop_policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(shop_policy_snapshot)='object'),
    accepted_at timestamptz,
    dispatched_at timestamptz,
    delivered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(order_id,shop_id),
    CHECK (seller_net_amount_minor<=subtotal_amount_minor+shipping_amount_minor-discount_amount_minor+tax_amount_minor)
);
CREATE INDEX ix_seller_orders_shop_status ON seller_orders(shop_id,status,created_at DESC);
CREATE INDEX ix_seller_orders_seller_status ON seller_orders(seller_id,status,created_at DESC);
CREATE INDEX ix_seller_orders_order ON seller_orders(order_id);

CREATE TABLE order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_order_id uuid NOT NULL REFERENCES seller_orders(id) ON DELETE RESTRICT,
    checkout_item_id uuid REFERENCES checkout_items(id) ON DELETE SET NULL,
    product_id uuid REFERENCES products(id) ON DELETE SET NULL,
    variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
    product_name_snapshot text NOT NULL,
    variant_label_snapshot text NOT NULL,
    seller_sku_snapshot text,
    product_condition_snapshot text,
    quantity integer NOT NULL CHECK (quantity>0),
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    unit_price_minor bigint NOT NULL CHECK (unit_price_minor>=0),
    discount_amount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_amount_minor>=0),
    tax_amount_minor bigint NOT NULL DEFAULT 0 CHECK (tax_amount_minor>=0),
    line_total_minor bigint NOT NULL CHECK (line_total_minor>=0),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (discount_amount_minor<=unit_price_minor*quantity),
    CHECK (line_total_minor=unit_price_minor*quantity-discount_amount_minor+tax_amount_minor)
);
CREATE INDEX ix_order_items_seller_order ON order_items(seller_order_id);
CREATE INDEX ix_order_items_product ON order_items(product_id) WHERE product_id IS NOT NULL;

CREATE TABLE order_addresses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    seller_order_id uuid REFERENCES seller_orders(id) ON DELETE RESTRICT,
    address_type text NOT NULL CHECK (address_type IN ('BILLING','SHIPPING')),
    recipient_name text NOT NULL CHECK (length(trim(recipient_name)) BETWEEN 1 AND 180),
    company_name text,
    address_line_1 text NOT NULL,
    address_line_2 text,
    city text NOT NULL,
    region text,
    postal_code text,
    country_code char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
    phone_e164 text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_order_addresses_order ON order_addresses(order_id,address_type);

CREATE TABLE order_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    from_status text,
    to_status text NOT NULL,
    reason text,
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_order_status_history_order ON order_status_history(order_id,created_at);

CREATE TABLE seller_order_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_order_id uuid NOT NULL REFERENCES seller_orders(id) ON DELETE RESTRICT,
    from_status text,
    to_status text NOT NULL,
    reason text,
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_seller_order_status_history_order ON seller_order_status_history(seller_order_id,created_at);

-- Commerce payments are separate from subscription Billing.
CREATE TABLE marketplace_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    provider_key text NOT NULL DEFAULT 'STRIPE',
    provider_payment_intent_id text,
    provider_charge_id text,
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    amount_minor bigint NOT NULL CHECK (amount_minor>=0),
    status text NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','REQUIRES_ACTION','PROCESSING','SUCCEEDED','FAILED','CANCELLED','PARTIALLY_REFUNDED','REFUNDED')),
    failure_code text,
    failure_message text,
    paid_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(provider_key,provider_payment_intent_id)
);
CREATE INDEX ix_marketplace_payments_order ON marketplace_payments(order_id,created_at DESC);
CREATE INDEX ix_marketplace_payments_status ON marketplace_payments(status,created_at);

CREATE TABLE marketplace_payment_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL REFERENCES marketplace_payments(id) ON DELETE RESTRICT,
    transaction_type text NOT NULL CHECK (transaction_type IN ('AUTHORIZATION','CAPTURE','FAILURE','PROCESSING_FEE','REFUND','DISPUTE','ADJUSTMENT')),
    provider_key text NOT NULL DEFAULT 'STRIPE',
    provider_transaction_id text,
    provider_balance_transaction_id text,
    amount_minor bigint NOT NULL,
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    status text NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED','REVERSED')),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
    UNIQUE(provider_key,provider_transaction_id)
);
CREATE INDEX ix_marketplace_payment_transactions_payment ON marketplace_payment_transactions(payment_id,occurred_at DESC);

CREATE TABLE seller_transfers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_order_id uuid NOT NULL REFERENCES seller_orders(id) ON DELETE RESTRICT,
    payment_id uuid NOT NULL REFERENCES marketplace_payments(id) ON DELETE RESTRICT,
    seller_payment_account_id uuid NOT NULL REFERENCES seller_payment_accounts(id) ON DELETE RESTRICT,
    provider_transfer_id text,
    transfer_group text NOT NULL,
    source_charge_id text,
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    gross_amount_minor bigint NOT NULL CHECK (gross_amount_minor>=0),
    commission_amount_minor bigint NOT NULL CHECK (commission_amount_minor>=0),
    adjustment_amount_minor bigint NOT NULL DEFAULT 0 CHECK (adjustment_amount_minor>=0),
    transfer_amount_minor bigint NOT NULL CHECK (transfer_amount_minor>=0),
    reversed_amount_minor bigint NOT NULL DEFAULT 0 CHECK (reversed_amount_minor>=0),
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','PARTIALLY_REVERSED','REVERSED')),
    failure_code text,
    transferred_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(seller_order_id,payment_id),
    UNIQUE(provider_transfer_id),
    CHECK (transfer_amount_minor<=gross_amount_minor),
    CHECK (reversed_amount_minor<=transfer_amount_minor)
);
CREATE INDEX ix_seller_transfers_account_status ON seller_transfers(seller_payment_account_id,status,created_at DESC);

CREATE TABLE marketplace_refunds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL REFERENCES marketplace_payments(id) ON DELETE RESTRICT,
    seller_order_id uuid REFERENCES seller_orders(id) ON DELETE RESTRICT,
    order_item_id uuid REFERENCES order_items(id) ON DELETE RESTRICT,
    provider_refund_id text UNIQUE,
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    amount_minor bigint NOT NULL CHECK (amount_minor>0),
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','PENDING','SUCCEEDED','FAILED','CANCELLED')),
    transfer_reversal_status text CHECK (transfer_reversal_status IS NULL OR transfer_reversal_status IN ('NOT_REQUIRED','PENDING','SUCCEEDED','FAILED')),
    requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    processed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(seller_order_id,order_item_id)<=2)
);
CREATE INDEX ix_marketplace_refunds_payment ON marketplace_refunds(payment_id,created_at DESC);

CREATE TABLE seller_payout_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_payment_account_id uuid NOT NULL REFERENCES seller_payment_accounts(id) ON DELETE RESTRICT,
    provider_payout_id text NOT NULL UNIQUE,
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    amount_minor bigint NOT NULL CHECK (amount_minor>=0),
    status text NOT NULL CHECK (status IN ('PENDING','IN_TRANSIT','PAID','FAILED','CANCELLED')),
    arrival_date date,
    paid_at timestamptz,
    failed_at timestamptz,
    failure_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_seller_payout_records_account ON seller_payout_records(seller_payment_account_id,created_at DESC);

CREATE TABLE marketplace_webhook_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_key text NOT NULL,
    external_event_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload)='object'),
    signature_verified boolean NOT NULL DEFAULT false,
    processing_status text NOT NULL DEFAULT 'RECEIVED' CHECK (processing_status IN ('RECEIVED','PROCESSING','PROCESSED','RETRY','FAILED','IGNORED')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    last_error text,
    UNIQUE(provider_key,external_event_id)
);
CREATE INDEX ix_marketplace_webhook_events_due ON marketplace_webhook_events(processing_status,received_at) WHERE processing_status IN ('RECEIVED','RETRY');

CREATE TABLE marketplace_ledger_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid REFERENCES orders(id) ON DELETE RESTRICT,
    seller_order_id uuid REFERENCES seller_orders(id) ON DELETE RESTRICT,
    payment_id uuid REFERENCES marketplace_payments(id) ON DELETE RESTRICT,
    event_type text NOT NULL,
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    idempotency_key text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED','VOID')),
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    posted_at timestamptz,
    CHECK (num_nonnulls(order_id,seller_order_id,payment_id)>=1)
);
CREATE INDEX ix_marketplace_ledger_transactions_order ON marketplace_ledger_transactions(order_id,created_at DESC) WHERE order_id IS NOT NULL;
CREATE INDEX ix_marketplace_ledger_transactions_seller_order ON marketplace_ledger_transactions(seller_order_id,created_at DESC) WHERE seller_order_id IS NOT NULL;

CREATE TABLE marketplace_ledger_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ledger_transaction_id uuid NOT NULL REFERENCES marketplace_ledger_transactions(id) ON DELETE RESTRICT,
    line_number integer NOT NULL CHECK (line_number>0),
    ledger_account_code text NOT NULL CHECK (ledger_account_code=upper(trim(ledger_account_code)) AND ledger_account_code ~ '^[A-Z][A-Z0-9_.-]*$'),
    entity_type text CHECK (entity_type IS NULL OR entity_type IN ('PLATFORM','SELLER')),
    seller_id uuid REFERENCES marketplace_sellers(id) ON DELETE RESTRICT,
    entry_side text NOT NULL CHECK (entry_side IN ('DEBIT','CREDIT')),
    amount_minor bigint NOT NULL CHECK (amount_minor>0),
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(ledger_transaction_id,line_number),
    CHECK ((entity_type='SELLER' AND seller_id IS NOT NULL) OR (entity_type IS DISTINCT FROM 'SELLER' AND seller_id IS NULL))
);
CREATE INDEX ix_marketplace_ledger_entries_account ON marketplace_ledger_entries(ledger_account_code,currency_code,created_at DESC);
CREATE INDEX ix_marketplace_ledger_entries_seller ON marketplace_ledger_entries(seller_id,currency_code,created_at DESC) WHERE seller_id IS NOT NULL;

CREATE TABLE marketplace_disputes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL REFERENCES marketplace_payments(id) ON DELETE RESTRICT,
    seller_order_id uuid REFERENCES seller_orders(id) ON DELETE RESTRICT,
    provider_dispute_id text UNIQUE,
    dispute_type text NOT NULL CHECK (dispute_type IN ('CHARGEBACK','BUYER_SELLER_CASE','PLATFORM_REVIEW')),
    reason_code text,
    amount_minor bigint NOT NULL CHECK (amount_minor>=0),
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    evidence_due_at timestamptz,
    status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','NEEDS_RESPONSE','UNDER_REVIEW','WON','LOST','CLOSED')),
    resolution text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz
);
CREATE INDEX ix_marketplace_disputes_status_due ON marketplace_disputes(status,evidence_due_at);

-- Shipment records support multiple parcels per seller order and RETURN parcels.
CREATE TABLE shipments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_order_id uuid NOT NULL REFERENCES seller_orders(id) ON DELETE RESTRICT,
    inventory_location_id uuid REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    return_request_id uuid,
    shipment_type text NOT NULL DEFAULT 'OUTBOUND' CHECK (shipment_type IN ('OUTBOUND','RETURN')),
    provider_key text,
    carrier_name text,
    service_name text,
    tracking_number text,
    tracking_url text,
    status text NOT NULL DEFAULT 'LABEL_PENDING' CHECK (status IN ('LABEL_PENDING','LABEL_CREATED','READY_TO_DISPATCH','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','FAILED','RETURNED_TO_SENDER','CANCELLED','LOST')),
    shipped_at timestamptz,
    delivered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_shipments_seller_order ON shipments(seller_order_id,created_at);
CREATE INDEX ix_shipments_tracking ON shipments(provider_key,tracking_number) WHERE tracking_number IS NOT NULL;

CREATE TABLE shipment_packages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE RESTRICT,
    package_number integer NOT NULL CHECK (package_number>0),
    weight_grams integer NOT NULL CHECK (weight_grams>0),
    length_mm integer NOT NULL CHECK (length_mm>0),
    width_mm integer NOT NULL CHECK (width_mm>0),
    height_mm integer NOT NULL CHECK (height_mm>0),
    package_type text,
    customs_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(customs_data)='object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(shipment_id,package_number)
);

CREATE TABLE shipment_items (
    shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
    quantity integer NOT NULL CHECK (quantity>0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(shipment_id,order_item_id)
);
CREATE INDEX ix_shipment_items_order_item ON shipment_items(order_item_id);

CREATE TABLE shipping_labels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_package_id uuid NOT NULL REFERENCES shipment_packages(id) ON DELETE RESTRICT,
    provider_key text NOT NULL,
    provider_label_id text,
    provider_transaction_id text,
    carrier_name text,
    service_name text,
    label_media_id uuid REFERENCES media_objects(id) ON DELETE RESTRICT,
    label_cost_minor bigint CHECK (label_cost_minor IS NULL OR label_cost_minor>=0),
    currency_code char(3) CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
    status text NOT NULL DEFAULT 'PURCHASED' CHECK (status IN ('PURCHASE_PENDING','PURCHASED','VOID_PENDING','VOIDED','FAILED')),
    purchased_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(provider_key,provider_label_id)
);
CREATE INDEX ix_shipping_labels_package ON shipping_labels(shipment_package_id);

CREATE TABLE shipping_tracking_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    provider_key text,
    provider_event_id text,
    event_code text,
    description text NOT NULL,
    location text,
    occurred_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(provider_key,provider_event_id)
);
CREATE INDEX ix_shipping_tracking_events_shipment ON shipping_tracking_events(shipment_id,occurred_at DESC);

CREATE TABLE marketplace_promotions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid REFERENCES shops(id) ON DELETE RESTRICT,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    promotion_name text NOT NULL CHECK (length(trim(promotion_name)) BETWEEN 1 AND 180),
    promotion_type text NOT NULL CHECK (promotion_type IN ('PRODUCT_DISCOUNT','CATEGORY_DISCOUNT','SHOP_WIDE','CAMPAIGN')),
    discount_type text NOT NULL CHECK (discount_type IN ('PERCENTAGE','FIXED_AMOUNT')),
    discount_value numeric(12,4) NOT NULL CHECK (discount_value>0),
    currency_code char(3) CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
    funding_party text NOT NULL DEFAULT 'SELLER' CHECK (funding_party IN ('SELLER','PLATFORM','SHARED')),
    start_at timestamptz NOT NULL,
    end_at timestamptz NOT NULL,
    usage_limit integer CHECK (usage_limit IS NULL OR usage_limit>0),
    status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SCHEDULED','ACTIVE','PAUSED','ENDED','CANCELLED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (end_at>start_at),
    CHECK ((discount_type='PERCENTAGE' AND discount_value<=100) OR discount_type='FIXED_AMOUNT')
);
CREATE INDEX ix_marketplace_promotions_shop_status ON marketplace_promotions(shop_id,status,start_at,end_at);
CREATE INDEX ix_marketplace_promotions_active ON marketplace_promotions(status,start_at,end_at);

CREATE TABLE promotion_products (
    promotion_id uuid NOT NULL REFERENCES marketplace_promotions(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    PRIMARY KEY(promotion_id,product_id)
);
CREATE TABLE promotion_categories (
    promotion_id uuid NOT NULL REFERENCES marketplace_promotions(id) ON DELETE CASCADE,
    category_id uuid NOT NULL REFERENCES product_categories(id) ON DELETE RESTRICT,
    PRIMARY KEY(promotion_id,category_id)
);

CREATE TABLE discount_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid REFERENCES shops(id) ON DELETE RESTRICT,
    code text NOT NULL CHECK (code=upper(trim(code)) AND length(code) BETWEEN 3 AND 64),
    discount_type text NOT NULL CHECK (discount_type IN ('PERCENTAGE','FIXED_AMOUNT','FREE_SHIPPING')),
    discount_value numeric(12,4) CHECK (discount_value IS NULL OR discount_value>0),
    currency_code char(3) CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
    minimum_order_amount_minor bigint CHECK (minimum_order_amount_minor IS NULL OR minimum_order_amount_minor>=0),
    total_usage_limit integer CHECK (total_usage_limit IS NULL OR total_usage_limit>0),
    per_user_usage_limit integer CHECK (per_user_usage_limit IS NULL OR per_user_usage_limit>0),
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','EXPIRED','CANCELLED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at>starts_at),
    CHECK ((discount_type='PERCENTAGE' AND discount_value BETWEEN 0.0001 AND 100) OR discount_type<>'PERCENTAGE')
);
CREATE UNIQUE INDEX ux_discount_codes_shop_code ON discount_codes(shop_id,code) WHERE shop_id IS NOT NULL;
CREATE UNIQUE INDEX ux_discount_codes_platform_code ON discount_codes(code) WHERE shop_id IS NULL;
CREATE INDEX ix_discount_codes_active_dates ON discount_codes(status,starts_at,ends_at);

CREATE TABLE discount_redemptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    discount_code_id uuid NOT NULL REFERENCES discount_codes(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    amount_minor bigint NOT NULL CHECK (amount_minor>=0),
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    funding_party text NOT NULL CHECK (funding_party IN ('SELLER','PLATFORM','SHARED')),
    redeemed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(discount_code_id,order_id)
);
CREATE INDEX ix_discount_redemptions_user ON discount_redemptions(user_id,redeemed_at DESC);

CREATE TABLE product_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    order_item_id uuid NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE RESTRICT,
    reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review_text text CHECK (review_text IS NULL OR length(review_text)<=5000),
    status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','PUBLISHED','HIDDEN','REMOVED','REJECTED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_product_reviews_product ON product_reviews(product_id,status,created_at DESC);

CREATE TABLE product_review_media (
    review_id uuid NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    display_order integer NOT NULL DEFAULT 0 CHECK (display_order>=0),
    PRIMARY KEY(review_id,media_id)
);

CREATE TABLE shop_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
    seller_order_id uuid NOT NULL UNIQUE REFERENCES seller_orders(id) ON DELETE RESTRICT,
    reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review_text text CHECK (review_text IS NULL OR length(review_text)<=5000),
    seller_response text CHECK (seller_response IS NULL OR length(seller_response)<=5000),
    responded_at timestamptz,
    status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','PUBLISHED','HIDDEN','REMOVED','REJECTED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_shop_reviews_shop ON shop_reviews(shop_id,status,created_at DESC);

CREATE TABLE return_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_order_id uuid NOT NULL REFERENCES seller_orders(id) ON DELETE RESTRICT,
    customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reason_code text NOT NULL,
    description text CHECK (description IS NULL OR length(description)<=5000),
    status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','UNDER_REVIEW','APPROVED','REJECTED','AWAITING_RETURN','RETURN_IN_TRANSIT','RECEIVED','INSPECTED','REFUND_PENDING','REFUNDED','CLOSED')),
    decision_reason text,
    requested_at timestamptz NOT NULL DEFAULT now(),
    decided_at timestamptz,
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_return_requests_seller_order ON return_requests(seller_order_id,status,created_at DESC);
CREATE INDEX ix_return_requests_customer ON return_requests(customer_user_id,created_at DESC);

CREATE TABLE return_request_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    return_request_id uuid NOT NULL REFERENCES return_requests(id) ON DELETE RESTRICT,
    order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
    quantity integer NOT NULL CHECK (quantity>0),
    item_condition text,
    reason_code text,
    requested_resolution text NOT NULL CHECK (requested_resolution IN ('REFUND','REPLACEMENT','EXCHANGE')),
    requested_refund_amount_minor bigint CHECK (requested_refund_amount_minor IS NULL OR requested_refund_amount_minor>=0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(return_request_id,order_item_id)
);

CREATE TABLE return_request_media (
    return_request_id uuid NOT NULL REFERENCES return_requests(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(return_request_id,media_id)
);

CREATE TABLE return_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    return_request_id uuid NOT NULL REFERENCES return_requests(id) ON DELETE RESTRICT,
    from_status text,
    to_status text NOT NULL,
    reason text,
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_return_status_history_request ON return_status_history(return_request_id,created_at);

-- RETURN shipments link to a return request after both domains exist.
ALTER TABLE shipments
    ADD CONSTRAINT fk_shipments_return_request FOREIGN KEY(return_request_id) REFERENCES return_requests(id) ON DELETE RESTRICT;
CREATE INDEX ix_shipments_return_request ON shipments(return_request_id) WHERE return_request_id IS NOT NULL;

CREATE TABLE marketplace_commission_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id uuid REFERENCES shops(id) ON DELETE RESTRICT,
    category_id uuid REFERENCES product_categories(id) ON DELETE RESTRICT,
    commission_basis_points integer CHECK (commission_basis_points IS NULL OR commission_basis_points BETWEEN 0 AND 10000),
    fixed_fee_minor bigint CHECK (fixed_fee_minor IS NULL OR fixed_fee_minor>=0),
    currency_code char(3) CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
    priority integer NOT NULL DEFAULT 0,
    effective_from timestamptz NOT NULL DEFAULT now(),
    effective_until timestamptz,
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(commission_basis_points,fixed_fee_minor)>=1),
    CHECK (effective_until IS NULL OR effective_until>effective_from)
);
CREATE INDEX ix_marketplace_commission_rules_lookup ON marketplace_commission_rules(status,priority DESC,effective_from DESC);
CREATE INDEX ix_marketplace_commission_rules_shop ON marketplace_commission_rules(shop_id,status,priority DESC) WHERE shop_id IS NOT NULL;

-- Provider-backed tax persistence only; no home-grown country-by-country tax engine.
CREATE TABLE tax_registrations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registrant_type text NOT NULL CHECK (registrant_type IN ('SELLER','PLATFORM')),
    seller_id uuid REFERENCES marketplace_sellers(id) ON DELETE RESTRICT,
    country_id uuid NOT NULL REFERENCES countries(id) ON DELETE RESTRICT,
    tax_type text NOT NULL CHECK (tax_type IN ('VAT','GST','SALES_TAX','OTHER')),
    registration_number text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','EXPIRED','REVOKED','REJECTED')),
    valid_from date,
    valid_until date,
    verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((registrant_type='SELLER' AND seller_id IS NOT NULL) OR (registrant_type='PLATFORM' AND seller_id IS NULL)),
    CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until>=valid_from),
    UNIQUE(registrant_type,seller_id,country_id,tax_type,registration_number)
);
CREATE UNIQUE INDEX ux_tax_registration_seller_natural ON tax_registrations(seller_id,country_id,tax_type,registration_number) WHERE seller_id IS NOT NULL;
CREATE UNIQUE INDEX ux_tax_registration_platform_natural ON tax_registrations(country_id,tax_type,registration_number) WHERE seller_id IS NULL;
CREATE INDEX ix_tax_registrations_seller_country ON tax_registrations(seller_id,country_id,status) WHERE seller_id IS NOT NULL;

CREATE TABLE tax_calculations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    checkout_session_id uuid REFERENCES checkout_sessions(id) ON DELETE RESTRICT,
    order_id uuid REFERENCES orders(id) ON DELETE RESTRICT,
    provider_key text NOT NULL,
    provider_calculation_id text NOT NULL,
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    taxable_subtotal_minor bigint NOT NULL DEFAULT 0 CHECK (taxable_subtotal_minor>=0),
    shipping_taxable_minor bigint NOT NULL DEFAULT 0 CHECK (shipping_taxable_minor>=0),
    total_tax_minor bigint NOT NULL CHECK (total_tax_minor>=0),
    status text NOT NULL DEFAULT 'CALCULATED' CHECK (status IN ('CALCULATED','COMMITTED','REVERSED','FAILED','EXPIRED')),
    calculated_at timestamptz NOT NULL DEFAULT now(),
    committed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(checkout_session_id,order_id)>=1),
    UNIQUE(provider_key,provider_calculation_id)
);
CREATE INDEX ix_tax_calculations_checkout ON tax_calculations(checkout_session_id,calculated_at DESC) WHERE checkout_session_id IS NOT NULL;
CREATE INDEX ix_tax_calculations_order ON tax_calculations(order_id,calculated_at DESC) WHERE order_id IS NOT NULL;

CREATE TABLE tax_calculation_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tax_calculation_id uuid NOT NULL REFERENCES tax_calculations(id) ON DELETE RESTRICT,
    order_item_id uuid REFERENCES order_items(id) ON DELETE RESTRICT,
    seller_order_id uuid REFERENCES seller_orders(id) ON DELETE RESTRICT,
    charge_type text NOT NULL CHECK (charge_type IN ('ITEM','SHIPPING','OTHER')),
    tax_type text NOT NULL CHECK (tax_type IN ('VAT','GST','SALES_TAX','OTHER')),
    jurisdiction_code text NOT NULL,
    provider_tax_rate_reference text,
    tax_rate numeric(9,6) NOT NULL CHECK (tax_rate>=0),
    taxable_amount_minor bigint NOT NULL CHECK (taxable_amount_minor>=0),
    tax_amount_minor bigint NOT NULL CHECK (tax_amount_minor>=0),
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    tax_inclusive boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((charge_type='ITEM' AND order_item_id IS NOT NULL) OR (charge_type<>'ITEM'))
);
CREATE INDEX ix_tax_calculation_lines_calculation ON tax_calculation_lines(tax_calculation_id);
CREATE INDEX ix_tax_calculation_lines_seller_order ON tax_calculation_lines(seller_order_id) WHERE seller_order_id IS NOT NULL;

CREATE TABLE tax_liability_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tax_calculation_id uuid NOT NULL REFERENCES tax_calculations(id) ON DELETE RESTRICT,
    tax_calculation_line_id uuid REFERENCES tax_calculation_lines(id) ON DELETE RESTRICT,
    seller_order_id uuid REFERENCES seller_orders(id) ON DELETE RESTRICT,
    liable_party text NOT NULL CHECK (liable_party IN ('SELLER','MARKETPLACE')),
    liable_seller_id uuid REFERENCES marketplace_sellers(id) ON DELETE RESTRICT,
    jurisdiction_code text NOT NULL,
    tax_type text NOT NULL,
    decision_source text NOT NULL CHECK (decision_source IN ('PROVIDER','APPROVED_CONFIGURATION','MANUAL_REVIEW')),
    reason_snapshot text NOT NULL,
    decided_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((liable_party='SELLER' AND liable_seller_id IS NOT NULL) OR (liable_party='MARKETPLACE' AND liable_seller_id IS NULL))
);
CREATE INDEX ix_tax_liability_records_calculation ON tax_liability_records(tax_calculation_id);
CREATE INDEX ix_tax_liability_records_seller_order ON tax_liability_records(seller_order_id) WHERE seller_order_id IS NOT NULL;

CREATE TABLE tax_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid REFERENCES orders(id) ON DELETE RESTRICT,
    seller_order_id uuid REFERENCES seller_orders(id) ON DELETE RESTRICT,
    issuer_type text NOT NULL CHECK (issuer_type IN ('SELLER','PLATFORM')),
    issuer_seller_id uuid REFERENCES marketplace_sellers(id) ON DELETE RESTRICT,
    document_type text NOT NULL CHECK (document_type IN ('INVOICE','CREDIT_NOTE')),
    document_number text NOT NULL,
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    taxable_amount_minor bigint NOT NULL DEFAULT 0 CHECK (taxable_amount_minor>=0),
    tax_amount_minor bigint NOT NULL DEFAULT 0 CHECK (tax_amount_minor>=0),
    total_amount_minor bigint NOT NULL CHECK (total_amount_minor>=0),
    media_id uuid REFERENCES media_objects(id) ON DELETE RESTRICT,
    provider_document_reference text,
    issued_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(order_id,seller_order_id)>=1),
    CHECK ((issuer_type='SELLER' AND issuer_seller_id IS NOT NULL) OR (issuer_type='PLATFORM' AND issuer_seller_id IS NULL))
);
CREATE UNIQUE INDEX ux_tax_documents_seller_number ON tax_documents(issuer_seller_id,document_number) WHERE issuer_seller_id IS NOT NULL;
CREATE UNIQUE INDEX ux_tax_documents_platform_number ON tax_documents(document_number) WHERE issuer_seller_id IS NULL;
CREATE INDEX ix_tax_documents_order ON tax_documents(order_id,issued_at DESC) WHERE order_id IS NOT NULL;

CREATE TABLE tax_document_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tax_document_id uuid NOT NULL REFERENCES tax_documents(id) ON DELETE RESTRICT,
    tax_calculation_line_id uuid REFERENCES tax_calculation_lines(id) ON DELETE RESTRICT,
    description text NOT NULL,
    quantity numeric(18,4) NOT NULL CHECK (quantity>0),
    unit_amount_minor bigint NOT NULL CHECK (unit_amount_minor>=0),
    taxable_amount_minor bigint NOT NULL CHECK (taxable_amount_minor>=0),
    tax_rate numeric(9,6) NOT NULL CHECK (tax_rate>=0),
    tax_amount_minor bigint NOT NULL CHECK (tax_amount_minor>=0),
    total_amount_minor bigint NOT NULL CHECK (total_amount_minor>=0),
    currency_code char(3) NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$')
);
CREATE INDEX ix_tax_document_lines_document ON tax_document_lines(tax_document_id);

CREATE TABLE tax_provider_configurations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_key text NOT NULL CHECK (provider_key=upper(trim(provider_key))),
    country_id uuid REFERENCES countries(id) ON DELETE RESTRICT,
    environment text NOT NULL CHECK (environment IN ('TEST','LIVE')),
    account_context text,
    capabilities jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(capabilities)='object'),
    non_secret_configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(non_secret_configuration)='object'),
    is_enabled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT(provider_key,country_id,environment,account_context)
);
CREATE INDEX ix_tax_provider_configurations_lookup ON tax_provider_configurations(provider_key,environment,is_enabled);

-- Validate supported currency codes in the country market configuration.
CREATE OR REPLACE FUNCTION validate_marketplace_country_currency_configuration()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM unnest(NEW.supported_currencies) AS c(code) WHERE c.code !~ '^[A-Z]{3}$') THEN
        RAISE EXCEPTION 'Supported marketplace currencies must be uppercase ISO-style three-letter codes' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_marketplace_country_currencies
BEFORE INSERT OR UPDATE OF supported_currencies,default_currency ON marketplace_country_settings
FOR EACH ROW EXECUTE FUNCTION validate_marketplace_country_currency_configuration();

CREATE OR REPLACE FUNCTION validate_marketplace_variant_price_currency()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_supported text[];
BEGIN
    SELECT supported_currencies INTO v_supported
      FROM marketplace_country_settings WHERE country_id=NEW.market_country_id;
    IF v_supported IS NULL OR NOT (NEW.currency_code::text=ANY(v_supported)) THEN
        RAISE EXCEPTION 'Variant price currency is not enabled for the selected marketplace country' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_marketplace_variant_price_currency
BEFORE INSERT OR UPDATE OF market_country_id,currency_code ON product_variant_prices
FOR EACH ROW EXECUTE FUNCTION validate_marketplace_variant_price_currency();

-- Cross-module conversation context validation. The original v10.12 trigger still
-- performs participant canonicalisation and business-member checks first.
CREATE OR REPLACE FUNCTION validate_shop_marketplace_conversation_context()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_seller marketplace_sellers%ROWTYPE;
    v_customer uuid;
    v_shop_id uuid;
    v_product_status text;
BEGIN
    IF NEW.context_type NOT IN ('SHOP','SHOP_PRODUCT','SHOP_ORDER') THEN
        RETURN NEW;
    END IF;

    IF NEW.context_type='SHOP' THEN
        SELECT s.id, ms.owner_user_id, ms.business_account_id
          INTO v_shop_id, v_seller.owner_user_id, v_seller.business_account_id
          FROM shops s JOIN marketplace_sellers ms ON ms.id=s.seller_id
         WHERE s.id=NEW.context_id AND s.status='ACTIVE' AND ms.status='ACTIVE';
    ELSIF NEW.context_type='SHOP_PRODUCT' THEN
        SELECT s.id, ms.owner_user_id, ms.business_account_id, p.status
          INTO v_shop_id, v_seller.owner_user_id, v_seller.business_account_id, v_product_status
          FROM products p JOIN shops s ON s.id=p.shop_id JOIN marketplace_sellers ms ON ms.id=s.seller_id
         WHERE p.id=NEW.context_id AND p.status='PUBLISHED' AND s.status='ACTIVE' AND ms.status='ACTIVE' AND p.deleted_at IS NULL;
    ELSE
        SELECT so.shop_id, ms.owner_user_id, ms.business_account_id, o.customer_user_id
          INTO v_shop_id, v_seller.owner_user_id, v_seller.business_account_id, v_customer
          FROM seller_orders so
          JOIN orders o ON o.id=so.order_id
          JOIN marketplace_sellers ms ON ms.id=so.seller_id
         WHERE so.id=NEW.context_id AND so.status NOT IN ('PAYMENT_PENDING','CANCELLED');
    END IF;

    IF v_shop_id IS NULL THEN
        RAISE EXCEPTION 'Marketplace conversation target does not exist or is not eligible' USING ERRCODE='23503';
    END IF;

    IF v_seller.owner_user_id IS NOT NULL THEN
        IF NOT ((NEW.participant_a_business_account_id IS NULL AND NEW.participant_a_id=v_seller.owner_user_id)
             OR (NEW.participant_b_business_account_id IS NULL AND NEW.participant_b_id=v_seller.owner_user_id)) THEN
            RAISE EXCEPTION 'Individual seller must be a conversation participant' USING ERRCODE='23514';
        END IF;
    ELSE
        IF NOT (NEW.participant_a_business_account_id=v_seller.business_account_id
             OR NEW.participant_b_business_account_id=v_seller.business_account_id) THEN
            RAISE EXCEPTION 'Seller Business Account must be a conversation participant' USING ERRCODE='23514';
        END IF;
    END IF;

    IF NEW.context_type='SHOP_ORDER' AND NOT (
        (NEW.participant_a_business_account_id IS NULL AND NEW.participant_a_id=v_customer)
        OR (NEW.participant_b_business_account_id IS NULL AND NEW.participant_b_id=v_customer)
    ) THEN
        RAISE EXCEPTION 'Order customer must be a conversation participant' USING ERRCODE='23514';
    END IF;

    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_shop_marketplace_conversation_context
BEFORE INSERT OR UPDATE OF context_type,context_id,participant_a_id,participant_b_id,participant_a_business_account_id,participant_b_business_account_id
ON direct_conversations
FOR EACH ROW EXECUTE FUNCTION validate_shop_marketplace_conversation_context();

-- A posted ledger transaction must balance per currency before commit. Application
-- services create the header and all entries in one database transaction.
CREATE OR REPLACE FUNCTION assert_marketplace_ledger_transaction_balanced()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_transaction_id uuid;
    v_status text;
    v_currency char(3);
    v_debits numeric;
    v_credits numeric;
    v_entry_count integer;
BEGIN
    IF TG_TABLE_NAME='marketplace_ledger_transactions' THEN
        v_transaction_id := COALESCE(NEW.id,OLD.id);
    ELSE
        v_transaction_id := COALESCE(NEW.ledger_transaction_id,OLD.ledger_transaction_id);
    END IF;

    SELECT status,currency_code INTO v_status,v_currency
      FROM marketplace_ledger_transactions WHERE id=v_transaction_id;
    IF v_status='POSTED' THEN
        SELECT count(*),
               COALESCE(sum(amount_minor) FILTER (WHERE entry_side='DEBIT'),0),
               COALESCE(sum(amount_minor) FILTER (WHERE entry_side='CREDIT'),0)
          INTO v_entry_count,v_debits,v_credits
          FROM marketplace_ledger_entries
         WHERE ledger_transaction_id=v_transaction_id AND currency_code=v_currency;
        IF v_entry_count<2 OR v_debits<=0 OR v_debits<>v_credits THEN
            RAISE EXCEPTION 'Posted marketplace ledger transaction % is not balanced',v_transaction_id USING ERRCODE='23514';
        END IF;
        IF EXISTS (SELECT 1 FROM marketplace_ledger_entries WHERE ledger_transaction_id=v_transaction_id AND currency_code<>v_currency) THEN
            RAISE EXCEPTION 'Marketplace ledger transaction % contains mixed currencies',v_transaction_id USING ERRCODE='23514';
        END IF;
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_marketplace_ledger_tx_balanced
AFTER INSERT OR UPDATE ON marketplace_ledger_transactions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_marketplace_ledger_transaction_balanced();
CREATE CONSTRAINT TRIGGER trg_marketplace_ledger_entries_balanced
AFTER INSERT OR UPDATE OR DELETE ON marketplace_ledger_entries
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_marketplace_ledger_transaction_balanced();

CREATE OR REPLACE FUNCTION prevent_marketplace_posted_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_tx_id uuid; v_status text;
BEGIN
    IF TG_TABLE_NAME='marketplace_ledger_transactions' THEN
        IF OLD.status='POSTED' AND (TG_OP='DELETE' OR NEW IS DISTINCT FROM OLD) THEN
            RAISE EXCEPTION 'Posted marketplace ledger transactions are immutable' USING ERRCODE='23514';
        END IF;
    ELSE
        v_tx_id:=COALESCE(OLD.ledger_transaction_id,NEW.ledger_transaction_id);
        SELECT status INTO v_status FROM marketplace_ledger_transactions WHERE id=v_tx_id;
        IF v_status='POSTED' THEN
            RAISE EXCEPTION 'Entries in a posted marketplace ledger transaction are immutable' USING ERRCODE='23514';
        END IF;
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_marketplace_ledger_tx_immutable
BEFORE UPDATE OR DELETE ON marketplace_ledger_transactions
FOR EACH ROW EXECUTE FUNCTION prevent_marketplace_posted_ledger_mutation();
CREATE TRIGGER trg_marketplace_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON marketplace_ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_marketplace_posted_ledger_mutation();

-- Cross-entity consistency guards that cannot be expressed as ordinary foreign keys.
CREATE OR REPLACE FUNCTION validate_marketplace_variant_seller()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_product_seller uuid;
BEGIN
    SELECT s.seller_id INTO v_product_seller FROM products p JOIN shops s ON s.id=p.shop_id WHERE p.id=NEW.product_id;
    IF v_product_seller IS NULL OR v_product_seller<>NEW.seller_id THEN
        RAISE EXCEPTION 'Product variant seller must match the owning product shop seller' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_marketplace_variant_seller
BEFORE INSERT OR UPDATE OF product_id,seller_id ON product_variants
FOR EACH ROW EXECUTE FUNCTION validate_marketplace_variant_seller();

CREATE OR REPLACE FUNCTION validate_marketplace_inventory_seller()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_inventory_shop uuid; v_product_shop uuid;
BEGIN
    SELECT shop_id INTO v_inventory_shop FROM inventory_locations WHERE id=NEW.inventory_location_id;
    SELECT p.shop_id INTO v_product_shop FROM product_variants pv JOIN products p ON p.id=pv.product_id WHERE pv.id=NEW.variant_id;
    IF v_inventory_shop IS NULL OR v_product_shop IS NULL OR v_inventory_shop<>v_product_shop THEN
        RAISE EXCEPTION 'Inventory location and product variant must belong to the same shop' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_marketplace_inventory_seller
BEFORE INSERT OR UPDATE OF inventory_location_id,variant_id ON inventory_items
FOR EACH ROW EXECUTE FUNCTION validate_marketplace_inventory_seller();

CREATE OR REPLACE FUNCTION validate_marketplace_order_seller()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_shop_seller uuid;
BEGIN
    SELECT seller_id INTO v_shop_seller FROM shops WHERE id=NEW.shop_id;
    IF v_shop_seller IS NULL OR v_shop_seller<>NEW.seller_id THEN
        RAISE EXCEPTION 'Seller order seller must own the referenced shop' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_marketplace_order_seller
BEFORE INSERT OR UPDATE OF seller_id,shop_id ON seller_orders
FOR EACH ROW EXECUTE FUNCTION validate_marketplace_order_seller();

CREATE OR REPLACE FUNCTION validate_marketplace_seller_order_currency()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_order_currency char(3);
BEGIN
    SELECT currency_code INTO v_order_currency FROM orders WHERE id=NEW.order_id;
    IF v_order_currency IS NULL OR v_order_currency<>NEW.currency_code THEN
        RAISE EXCEPTION 'Seller order currency must match its parent order currency' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_marketplace_seller_order_currency
BEFORE INSERT OR UPDATE OF order_id,currency_code ON seller_orders
FOR EACH ROW EXECUTE FUNCTION validate_marketplace_seller_order_currency();

-- Documentation comments for operationally important invariants.
COMMENT ON TABLE marketplace_country_settings IS 'Country-level marketplace enablement. Country reference existence alone never enables checkout, seller onboarding or payouts.';
COMMENT ON TABLE marketplace_sellers IS 'Legal seller/payment entity. Exactly one of owner_user_id or business_account_id is populated; business permissions reuse business_account_members.';
COMMENT ON TABLE seller_payment_accounts IS 'Provider connected-account relationship per legal seller. Multiple shops owned by the same seller share the account.';
COMMENT ON TABLE product_market_availability IS 'Explicit per-destination product eligibility; community membership does not determine marketplace availability.';
COMMENT ON TABLE product_variant_prices IS 'Explicit market-country and currency price in currency minor units; no implicit FX conversion.';
COMMENT ON TABLE inventory_reservations IS 'Temporary stock holds. Availability is on-hand minus active unexpired reservations; reservation creation must use transactional locking/atomic updates.';
COMMENT ON TABLE orders IS 'Parent customer order for one mixed-seller checkout. Created PAYMENT_PENDING before PaymentIntent confirmation.';
COMMENT ON TABLE seller_orders IS 'Independent seller/shop fulfilment order under a parent order. Seller order state is independent of other sellers.';
COMMENT ON TABLE marketplace_payments IS 'Marketplace customer commerce payment attempts. Separate from subscription billing_payments.';
COMMENT ON TABLE seller_transfers IS 'Transfers from platform balance to connected seller account; not the seller bank payout.';
COMMENT ON TABLE seller_payout_records IS 'Provider payout records from connected account to bank. A transfer is not a payout.';
COMMENT ON TABLE marketplace_ledger_entries IS 'Append-only double-entry financial postings; posted journal entries must balance per currency.';
COMMENT ON TABLE shipments IS 'Outbound or RETURN shipments. One seller order can have multiple shipments and packages.';
COMMENT ON TABLE tax_liability_records IS 'Immutable liability decision snapshot. External tax calculations do not, by themselves, determine every marketplace legal liability.';
COMMENT ON TABLE tax_provider_configurations IS 'Non-secret provider settings only. API keys and webhook secrets belong in a secret manager.';

-- Marketplace media purposes are added to the existing media_objects.purpose CHECK above.
-- Featured SHOP/PRODUCT targets are added to the existing content_reference_type and
-- featured_placement_rules allow-list above. Reports reuse report_target_type and reports.
-- Direct-conversation SHOP/SHOP_PRODUCT/SHOP_ORDER contexts are guarded above.
-- Marketplace notifications extend the shared notification_type enum above.

-- End of v10.13 global Shop Marketplace additions.

-- Marketplace application query support (additive to the v10.13 candidate).
CREATE INDEX IF NOT EXISTS ix_products_published_recent ON products(published_at DESC, id DESC) WHERE status='PUBLISHED' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_wishlist_items_product ON wishlist_items(product_id);
CREATE INDEX IF NOT EXISTS ix_seller_transfers_seller_order ON seller_transfers(seller_order_id);
CREATE INDEX IF NOT EXISTS ix_marketplace_payments_checkout_ref ON marketplace_payments(provider_key, provider_charge_id) WHERE provider_charge_id IS NOT NULL;
