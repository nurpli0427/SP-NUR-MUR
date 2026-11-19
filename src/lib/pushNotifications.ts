export type PushPermissionState = NotificationPermission | 'unsupported';

export function getPushPermissionState(): PushPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestPushPermission(): Promise<PushPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  const result = await Notification.requestPermission();
  return result;
}

export async function sendClinicalPushNotification(params: {
  title: string;
  body: string;
  tag?: string;
  requireInteraction?: boolean;
}): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  if (Notification.permission !== 'granted') {
    return false;
  }

  const options: NotificationOptions & { vibrate?: number[] } = {
    body: params.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: params.tag || `carenote_${Date.now()}`,
    requireInteraction: params.requireInteraction ?? false,
    vibrate: [200, 100, 200],
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(params.title, options);
        return true;
      }
    }
    new Notification(params.title, options);
    return true;
  } catch {
    try {
      new Notification(params.title, options);
      return true;
    } catch {
      return false;
    }
  }
}
