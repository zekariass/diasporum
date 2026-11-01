/** Tests for env config validation (first-party auth — no Keycloak). */

type EnvModule = typeof import('@/core/config/env');

function setValidEnv() {
  process.env.EXPO_PUBLIC_APP_ENV = 'development';
  process.env.EXPO_PUBLIC_API_BASE_URL = 'http://localhost:8080';
  process.env.EXPO_PUBLIC_AUTH_REDIRECT_URI = 'diasporummobile://callback';
}

function clearEnv() {
  delete process.env.EXPO_PUBLIC_APP_ENV;
  delete process.env.EXPO_PUBLIC_API_BASE_URL;
  delete process.env.EXPO_PUBLIC_AUTH_REDIRECT_URI;
}

function loadEnv(): EnvModule {
  return require('@/core/config/env') as EnvModule;
}

describe('env config validation', () => {
  afterEach(clearEnv);

  it('builds config successfully with all valid variables', () => {
    setValidEnv();
    let mod!: EnvModule;
    jest.isolateModules(() => { mod = loadEnv(); });
    expect(mod.appConfig.appEnv).toBe('development');
    expect(mod.appConfig.apiBaseUrl).toBe('http://localhost:8080');
    expect(mod.appConfig.authRedirectUri).toBe('diasporummobile://callback');
    // Provider ids are optional — Google/Apple sign-in degrades gracefully.
    expect(mod.appConfig.googleWebClientId).toBe('');
    expect(mod.appConfig.appleClientId).toBe('');
  });

  it('throws when EXPO_PUBLIC_APP_ENV is missing', () => {
    setValidEnv();
    delete process.env.EXPO_PUBLIC_APP_ENV;
    expect(() => { jest.isolateModules(() => { loadEnv(); }); })
      .toThrow('EXPO_PUBLIC_APP_ENV');
  });

  it('throws when EXPO_PUBLIC_API_BASE_URL is missing', () => {
    setValidEnv();
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    expect(() => { jest.isolateModules(() => { loadEnv(); }); })
      .toThrow('EXPO_PUBLIC_API_BASE_URL');
  });

  it('throws when EXPO_PUBLIC_APP_ENV has an invalid value', () => {
    setValidEnv();
    process.env.EXPO_PUBLIC_APP_ENV = 'local';
    expect(() => { jest.isolateModules(() => { loadEnv(); }); })
      .toThrow('development, staging, production');
  });

  it('accepts staging and production environments', () => {
    for (const env of ['staging', 'production'] as const) {
      setValidEnv();
      process.env.EXPO_PUBLIC_APP_ENV = env;
      let mod!: EnvModule;
      jest.isolateModules(() => { mod = loadEnv(); });
      expect(mod.appConfig.appEnv).toBe(env);
    }
  });
});
