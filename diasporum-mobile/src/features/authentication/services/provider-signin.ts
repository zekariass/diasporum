/**
 * Native provider sign-in — Google + Apple.
 *
 * These functions obtain a provider-issued ID token via the NATIVE SDKs
 * (no WebViews). The token is then sent to the Diasporum backend, which is
 * the sole authority on verification — a successful client-side sign-in is
 * never treated as authentication by itself.
 */

import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';

import { appConfig } from '@/core/config/env';
import { AuthError } from '@/core/auth/auth-errors';

// ---- Google (@react-native-google-signin/google-signin) ----

let googleConfigured = false;

function configureGoogle(): boolean {
  // webClientId is required: the idToken's `aud` will be the web client id,
  // which must be present in DIASPORUM_GOOGLE_CLIENT_IDS on the backend.
  if (!appConfig.googleWebClientId) return false;
  if (googleConfigured) return true;
  // Lazy require — the native module is unavailable in Expo Go/web.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { GoogleSignin } = require('@react-native-google-signin/google-signin');
  GoogleSignin.configure({
    webClientId: appConfig.googleWebClientId,
    iosClientId: appConfig.googleIosClientId || undefined,
    offlineAccess: false,
  });
  googleConfigured = true;
  return true;
}

/** Returns a Google idToken, or throws a mapped AuthError. */
export async function getGoogleIdToken(): Promise<string> {
  if (Platform.OS === 'web') {
    throw new AuthError('CONFIGURATION_ERROR', 'Google sign-in unsupported on web');
  }
  if (!configureGoogle()) {
    throw new AuthError('CONFIGURATION_ERROR', 'Google client ids missing');
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { GoogleSignin, statusCodes } =
    require('@react-native-google-signin/google-signin');
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const result = await GoogleSignin.signIn();
    // v13+ shape: { data: { idToken } }; legacy: { idToken }
    const idToken = result?.data?.idToken ?? result?.idToken;
    if (!idToken) throw new AuthError('PROVIDER_TOKEN_INVALID', 'No idToken');
    return idToken;
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === statusCodes?.SIGN_IN_CANCELLED || code === '5') {
      throw new AuthError('AUTH_CANCELLED');
    }
    if (code === statusCodes?.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new AuthError('CONFIGURATION_ERROR', 'Play Services unavailable');
    }
    if (e instanceof AuthError) throw e;
    throw new AuthError('AUTH_FAILED', `Google sign-in failed: ${code ?? e}`);
  }
}

// ---- Apple (expo-apple-authentication) ----

export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'macos') return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AppleAuthentication = require('expo-apple-authentication');
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export interface AppleSignInResult {
  idToken: string;
  /** Present ONLY on the first authorization — may be undefined afterwards. */
  fullName?: { givenName?: string | null; familyName?: string | null };
  email?: string;
}

/** Returns an Apple identityToken (+ first-auth name/email when supplied). */
export async function getAppleCredential(): Promise<AppleSignInResult> {
  if (!(await isAppleSignInAvailable())) {
    throw new AuthError('CONFIGURATION_ERROR', 'Apple sign-in unavailable');
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AppleAuthentication = require('expo-apple-authentication');
  const nonce = Crypto.randomUUID();
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce,
    });
    if (!credential.identityToken) {
      throw new AuthError('PROVIDER_TOKEN_INVALID', 'No identityToken');
    }
    return {
      idToken: credential.identityToken,
      fullName: credential.fullName ?? undefined,
      email: credential.email ?? undefined,
    };
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED') {
      throw new AuthError('AUTH_CANCELLED');
    }
    if (e instanceof AuthError) throw e;
    throw new AuthError('AUTH_FAILED', `Apple sign-in failed: ${code ?? e}`);
  }
}
