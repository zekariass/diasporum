/**
 * Taxonomy API service — countries, languages, communities catalogue.
 * All methods are typed and use the centralized API client.
 */

import type { ApiClient } from '@/core/api/api-client';
import type {
  CountryView,
  LanguageView,
  CommunityView,
  PagedResponse,
} from '@/features/communities/types/community-types';

export function createTaxonomyApi(client: ApiClient) {
  return {
    countries(params: { search?: string; active?: boolean } = {}) {
      const q = new URLSearchParams();
      if (params.active !== undefined) q.set('active', String(params.active));
      if (params.search) q.set('search', params.search);
      q.set('size', '200');
      return client.get<PagedResponse<CountryView>>(
        `/api/v1/taxonomy/countries?${q}`,
        { authenticated: true }
      );
    },

    languages(params: { search?: string; active?: boolean } = {}) {
      const q = new URLSearchParams();
      if (params.active !== undefined) q.set('active', String(params.active));
      if (params.search) q.set('search', params.search);
      q.set('size', '200');
      return client.get<PagedResponse<LanguageView>>(
        `/api/v1/taxonomy/languages?${q}`,
        { authenticated: true }
      );
    },

    communities(params: {
      originCountryId?: string;
      search?: string;
      active?: boolean;
    } = {}) {
      const q = new URLSearchParams();
      if (params.active !== undefined) q.set('active', String(params.active));
      if (params.originCountryId) q.set('originCountryId', params.originCountryId);
      if (params.search) q.set('search', params.search);
      q.set('size', '100');
      return client.get<PagedResponse<CommunityView>>(
        `/api/v1/taxonomy/communities?${q}`,
        { authenticated: true }
      );
    },

    /** All active countries — for pickers. Wraps taxonomy/countries. */
    activeCountries() {
      return this.countries({ active: true });
    },

    /** All active languages — for pickers. */
    activeLanguages() {
      return this.languages({ active: true });
    },
  };
}

export type TaxonomyApi = ReturnType<typeof createTaxonomyApi>;
