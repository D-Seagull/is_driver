import * as Sentry from '@sentry/react-native';
import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';
import * as Updates from 'expo-updates';

import { SENTRY_DSN } from '@/lib/config';

/**
 * Crash / error reporting. Off in dev and whenever no DSN is configured
 * (app.json → expo.extra.SENTRY_DSN), so local runs never report.
 *
 * Privacy: errors only — no tracing, replay, screenshots or PII. Breadcrumbs
 * keep the shape of what happened (method, status, path) but never bodies,
 * headers, query strings or console output (which can hold phone numbers,
 * message text or tokens). The user is tagged by id only (setSentryUser).
 *
 * `release` is left to the SDK: it reads it natively as
 * `<package>@<version>+<build>`, which is also what the build-time source map
 * upload is keyed by.
 */
export function initSentry() {
  Sentry.init({
    dsn: SENTRY_DSN || undefined,
    enabled: !__DEV__ && !!SENTRY_DSN,
    // EAS channel of the running build/update: "preview" | "production".
    environment: __DEV__ ? 'development' : (Updates.channel ?? 'unknown'),
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubEvent,
  });
}

/** Tag reports with the signed-in user's id (nothing else); null clears it. */
export function setSentryUser(id: string | null | undefined) {
  Sentry.setUser(id ? { id } : null);
}

export const wrapRoot = Sentry.wrap;

function stripQuery(url: unknown): unknown {
  return typeof url === 'string' ? url.split('?')[0] : url;
}

function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  // console.log output may contain anything the app printed.
  if (crumb.category === 'console') return null;
  if (crumb.category === 'xhr' || crumb.category === 'fetch') {
    const d = crumb.data ?? {};
    crumb.data = {
      method: d.method,
      status_code: d.status_code,
      url: stripQuery(d.url),
    };
    return crumb;
  }
  // Touch breadcrumbs carry element labels (names on screen) — keep only
  // the message (the touched component).
  if (crumb.category === 'touch') {
    delete crumb.data;
    return crumb;
  }
  if (crumb.data) {
    for (const key of ['url', 'from', 'to']) {
      if (key in crumb.data) crumb.data[key] = stripQuery(crumb.data[key]);
    }
  }
  return crumb;
}

function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.data;
    delete event.request.headers;
    delete event.request.cookies;
    delete event.request.query_string;
    event.request.url = stripQuery(event.request.url) as string | undefined;
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
  return event;
}
