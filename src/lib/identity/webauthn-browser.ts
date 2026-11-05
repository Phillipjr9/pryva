/**
 * The browser half of a passkey ceremony.
 *
 * WebAuthn hands the browser `ArrayBuffer`s and hands the server base64url
 * strings, so something has to convert between them. That is all this module
 * does — no decisions, no state, no network — which is what makes it testable in
 * Node with plain objects.
 *
 * The conversion is the part people get wrong: a padded base64 string, or a
 * `DataView` where a `Uint8Array` was expected, produces a `TypeError` from the
 * browser that says nothing useful. `base64UrlToBuffer` and
 * `bufferToBase64Url` below are the only two functions allowed to do it.
 */

/** `-` and `_` instead of `+` and `/`, no padding. URL-safe and JSON-safe. */
export function bufferToBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBuffer(value: string): ArrayBuffer {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

/** Whether this browser can do WebAuthn at all. */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined"
    && typeof window.PublicKeyCredential !== "undefined"
    && typeof navigator !== "undefined"
    && typeof navigator.credentials?.create === "function"
    && typeof navigator.credentials?.get === "function";
}

/** Whether the platform has a built-in authenticator (Touch ID, Windows Hello, …). */
export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

type ServerDescriptor = { id: string; type?: string; transports?: string[] };

type ServerCreationOptions = {
  challenge: string;
  user: { id: string; name: string; displayName: string };
  excludeCredentials?: ServerDescriptor[];
  [key: string]: unknown;
};

/** The server sends transport names as plain strings; the DOM types are a union. */
function toDescriptors(credentials: ServerDescriptor[] | undefined): PublicKeyCredentialDescriptor[] {
  return (credentials ?? []).map((credential) => {
    const descriptor: PublicKeyCredentialDescriptor = {
      id: base64UrlToBuffer(credential.id),
      type: "public-key",
    };
    if (credential.transports && credential.transports.length > 0) {
      descriptor.transports = credential.transports as AuthenticatorTransport[];
    }
    return descriptor;
  });
}

/** Server JSON → the object `navigator.credentials.create()` expects. */
export function encodeCreationOptions(options: ServerCreationOptions): PublicKeyCredentialCreationOptions {
  return {
    ...(options as unknown as PublicKeyCredentialCreationOptions),
    challenge: base64UrlToBuffer(options.challenge),
    user: {
      ...options.user,
      id: base64UrlToBuffer(options.user.id),
    },
    excludeCredentials: toDescriptors(options.excludeCredentials),
  };
}

type ServerRequestOptions = {
  challenge: string;
  allowCredentials?: ServerDescriptor[];
  [key: string]: unknown;
};

/** Server JSON → the object `navigator.credentials.get()` expects. */
export function encodeRequestOptions(options: ServerRequestOptions): PublicKeyCredentialRequestOptions {
  return {
    ...(options as unknown as PublicKeyCredentialRequestOptions),
    challenge: base64UrlToBuffer(options.challenge),
    allowCredentials: toDescriptors(options.allowCredentials),
  };
}

/** The registration response, in the shape the verification library expects. */
export function registrationResponseToJson(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAttestationResponse;
  const transports = typeof response.getTransports === "function" ? response.getTransports() : undefined;
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      attestationObject: bufferToBase64Url(response.attestationObject),
      ...(transports && transports.length > 0 ? { transports } : {}),
    },
  };
}

/** The sign-in response, in the shape the verification library expects. */
export function authenticationResponseToJson(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      signature: bufferToBase64Url(response.signature),
      userHandle: response.userHandle ? bufferToBase64Url(response.userHandle) : undefined,
    },
  };
}

/**
 * True when the customer dismissed the browser's passkey prompt.
 *
 * Worth knowing on its own: "you cancelled" is not an error to apologise for,
 * and it must not be logged as a failed attempt.
 */
export function isCancellation(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError");
}
