-- DIASPORUM v10.13 SHOP MARKETPLACE CATALOG ASSERTIONS
-- Run only after Diasporum_v10_13_strict_clean_install.sql succeeds on a disposable clean DB.
-- These are schema/catalog checks, not provider, legal, business-flow or concurrency tests.
BEGIN;
DO $$
DECLARE v_missing text[]; v_count integer;
BEGIN
    SELECT array_agg(t.name ORDER BY t.name) INTO v_missing
    FROM unnest(ARRAY[
      'marketplace_country_settings','marketplace_sellers','seller_payment_accounts','shops','shop_policies','shop_shipping_profiles','shop_media',
      'product_categories','product_category_translations','product_attribute_definitions','product_attribute_options','products','product_market_availability','product_variants','product_variant_attribute_values','product_variant_prices','product_media','product_tags','product_tag_assignments',
      'inventory_locations','inventory_items','inventory_reservations','inventory_movements',
      'shopping_carts','shopping_cart_items','wishlists','wishlist_items','checkout_sessions','checkout_items','shipping_rate_quotes',
      'orders','seller_orders','order_items','order_addresses','order_status_history','seller_order_status_history',
      'marketplace_payments','marketplace_payment_transactions','seller_transfers','marketplace_refunds','seller_payout_records','marketplace_webhook_events','marketplace_ledger_transactions','marketplace_ledger_entries','marketplace_disputes',
      'shipping_zones','shipping_zone_countries','shipping_methods','shipping_method_rules','shipments','shipment_items','shipment_packages','shipping_labels','shipping_tracking_events',
      'marketplace_promotions','promotion_products','promotion_categories','discount_codes','discount_redemptions',
      'product_reviews','product_review_media','shop_reviews',
      'return_requests','return_request_items','return_request_media','return_status_history',
      'marketplace_commission_rules',
      'tax_registrations','tax_calculations','tax_calculation_lines','tax_liability_records','tax_documents','tax_document_lines','tax_provider_configurations'
    ]) AS t(name)
    WHERE to_regclass('public.'||t.name) IS NULL;
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'Missing marketplace tables: %', array_to_string(v_missing,', ');
    END IF;

    SELECT count(*) INTO v_count
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r'
       AND c.relname = ANY(ARRAY[
      'marketplace_country_settings','marketplace_sellers','seller_payment_accounts','shops','shop_policies','shop_shipping_profiles','shop_media',
      'product_categories','product_category_translations','product_attribute_definitions','product_attribute_options','products','product_market_availability','product_variants','product_variant_attribute_values','product_variant_prices','product_media','product_tags','product_tag_assignments',
      'inventory_locations','inventory_items','inventory_reservations','inventory_movements',
      'shopping_carts','shopping_cart_items','wishlists','wishlist_items','checkout_sessions','checkout_items','shipping_rate_quotes',
      'orders','seller_orders','order_items','order_addresses','order_status_history','seller_order_status_history',
      'marketplace_payments','marketplace_payment_transactions','seller_transfers','marketplace_refunds','seller_payout_records','marketplace_webhook_events','marketplace_ledger_transactions','marketplace_ledger_entries','marketplace_disputes',
      'shipping_zones','shipping_zone_countries','shipping_methods','shipping_method_rules','shipments','shipment_items','shipment_packages','shipping_labels','shipping_tracking_events',
      'marketplace_promotions','promotion_products','promotion_categories','discount_codes','discount_redemptions',
      'product_reviews','product_review_media','shop_reviews',
      'return_requests','return_request_items','return_request_media','return_status_history',
      'marketplace_commission_rules',
      'tax_registrations','tax_calculations','tax_calculation_lines','tax_liability_records','tax_documents','tax_document_lines','tax_provider_configurations'
       ]);
    IF v_count<>74 THEN RAISE EXCEPTION 'Expected 74 marketplace tables, found %',v_count; END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='content_reference_type' AND e.enumlabel='SHOP')
       OR NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='content_reference_type' AND e.enumlabel='PRODUCT') THEN
       RAISE EXCEPTION 'Featured content enum is missing SHOP/PRODUCT';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='report_target_type' AND e.enumlabel='PRODUCT_REVIEW') THEN
       RAISE EXCEPTION 'Report target enum is missing marketplace targets';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM featured_placement_rules WHERE content_type='SHOP' AND placement_key='MARKETPLACE_SHOPS' AND is_enabled)
       OR NOT EXISTS (SELECT 1 FROM featured_placement_rules WHERE content_type='PRODUCT' AND placement_key='MARKETPLACE_PRODUCTS' AND is_enabled) THEN
       RAISE EXCEPTION 'Marketplace featured placement allow-list seed is incomplete';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_shop_marketplace_conversation_context' AND NOT tgisinternal) THEN
       RAISE EXCEPTION 'Marketplace conversation context trigger is missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_marketplace_ledger_entries_balanced' AND NOT tgisinternal) THEN
       RAISE EXCEPTION 'Marketplace ledger balance constraint trigger is missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_shipments_return_request') THEN
       RAISE EXCEPTION 'Return shipment relationship is missing';
    END IF;
END;
$$;

-- Shared global location catalogue assertions. location_places is platform reference
-- data, not a marketplace table, so the 74-table marketplace count above is unchanged.
-- Behavioural fixtures below are rolled back with this transaction.
DO $$
DECLARE
    v_country uuid; v_place uuid; v_place_inactive uuid;
    v_user uuid; v_user2 uuid; v_point geography; v_stored geography;
BEGIN
    IF to_regclass('public.location_places') IS NULL THEN
        RAISE EXCEPTION 'Missing shared table: location_places';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                   JOIN pg_class t ON t.oid=c.conrelid JOIN pg_class r ON r.oid=c.confrelid
                   WHERE t.relname='location_places' AND r.relname='countries' AND c.contype='f') THEN
        RAISE EXCEPTION 'location_places.country_id must reference countries.id';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM geography_columns
                   WHERE f_table_name='location_places' AND f_geography_column='location'
                     AND srid=4326 AND type='Point') THEN
        RAISE EXCEPTION 'location_places.location must be geography(Point,4326)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                   WHERE tablename='location_places' AND indexname='ix_location_places_location_gist'
                     AND indexdef ILIKE '%USING gist%') THEN
        RAISE EXCEPTION 'location_places is missing its spatial GiST index';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='location_places' AND column_name='alternative_names'
                     AND data_type='ARRAY') THEN
        RAISE EXCEPTION 'location_places.alternative_names must be an array column';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='user_discovery_locations' AND column_name='location_place_id') THEN
        RAISE EXCEPTION 'user_discovery_locations.location_place_id is missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid='user_discovery_locations'::regclass
                     AND confrelid='location_places'::regclass
                     AND contype='f' AND confdeltype='r') THEN
        RAISE EXCEPTION 'user_discovery_locations.location_place_id must reference location_places ON DELETE RESTRICT';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_user_discovery_locations_place' AND NOT tgisinternal)
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_location_places_point_propagation' AND NOT tgisinternal) THEN
        RAISE EXCEPTION 'Discovery-location catalogue consistency triggers are missing';
    END IF;

    -- Behavioural assertions (rolled back).
    INSERT INTO countries(name,iso2) VALUES('Fixturland','ZZ') RETURNING id INTO v_country;
    INSERT INTO location_places(country_id,region,city,display_name,alternative_names,location,location_precision)
    VALUES(v_country,'South Region','Arba','Arba, South Region, Fixturland',ARRAY['Arba City'],
           ST_SetSRID(ST_MakePoint(37.0,6.0),4326)::geography,'CITY')
    RETURNING id,location INTO v_place,v_point;

    -- Duplicate place in the same country/region/city spelling is rejected.
    BEGIN
        INSERT INTO location_places(country_id,region,city,display_name,location,location_precision)
        VALUES(v_country,'south region','ARBA','Arba duplicate',v_point,'CITY');
        RAISE EXCEPTION 'Duplicate catalogue place was not rejected';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    -- A different place type with the same names is allowed.
    INSERT INTO location_places(country_id,region,city,display_name,location,location_precision)
    VALUES(v_country,'South Region','Arba','Arba District',v_point,'DISTRICT');
    -- Alternative names are searchable via array containment.
    IF NOT EXISTS (SELECT 1 FROM location_places
                   WHERE id=v_place AND alternative_names @> ARRAY['Arba City']) THEN
        RAISE EXCEPTION 'Alternative place name lookup failed';
    END IF;
    INSERT INTO location_places(country_id,region,city,display_name,location,location_precision,is_active)
    VALUES(v_country,'North Region','Inact','Inact, North Region, Fixturland',v_point,'CITY',false)
    RETURNING id INTO v_place_inactive;

    INSERT INTO users(email) VALUES('loc-test-a@example.test') RETURNING id INTO v_user;
    INSERT INTO users(email) VALUES('loc-test-b@example.test') RETURNING id INTO v_user2;

    -- Manual catalogue selection derives the stored point from the catalogue row even
    -- when a different point is supplied; client coordinates are never trusted.
    INSERT INTO user_discovery_locations(user_id,location,location_source,location_place_id)
    VALUES(v_user,ST_SetSRID(ST_MakePoint(0,0),4326)::geography,'CITY_CENTRE',v_place)
    RETURNING location INTO v_stored;
    IF ST_AsText(v_stored) IS DISTINCT FROM ST_AsText(v_point) THEN
        RAISE EXCEPTION 'Catalogue-selected discovery point was not derived from location_places.location';
    END IF;

    -- Inactive places cannot be newly selected (trigger raises check_violation 23514).
    BEGIN
        INSERT INTO user_discovery_locations(user_id,location,location_source,location_place_id)
        VALUES(v_user2,v_point,'CITY_CENTRE',v_place_inactive);
        RAISE EXCEPTION 'Inactive catalogue place was selectable';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- A catalogue reference requires the CITY_CENTRE source.
    BEGIN
        INSERT INTO user_discovery_locations(user_id,location,location_source,location_place_id)
        VALUES(v_user2,v_point,'DEVICE_APPROXIMATE',v_place);
        RAISE EXCEPTION 'Catalogue place with non-CITY_CENTRE source was not rejected';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- Device-approximate discovery remains valid without a catalogue place.
    INSERT INTO user_discovery_locations(user_id,location,location_source)
    VALUES(v_user2,v_point,'DEVICE_APPROXIMATE');

    -- A curated place-centre correction propagates to referencing discovery rows.
    UPDATE location_places SET location=ST_SetSRID(ST_MakePoint(37.5,6.5),4326)::geography WHERE id=v_place;
    SELECT location INTO v_stored FROM user_discovery_locations WHERE user_id=v_user;
    IF ST_AsText(v_stored) IS DISTINCT FROM ST_AsText(ST_SetSRID(ST_MakePoint(37.5,6.5),4326)::geography) THEN
        RAISE EXCEPTION 'Catalogue point correction did not propagate to user_discovery_locations';
    END IF;

    -- Referenced places cannot be deleted; historical references are preserved.
    BEGIN
        DELETE FROM location_places WHERE id=v_place;
        RAISE EXCEPTION 'Referenced catalogue place was deletable';
    EXCEPTION WHEN foreign_key_violation THEN NULL;
    END;
END;
$$;
ROLLBACK;
