import notifee, {
  AndroidImportance,
  AndroidVisibility,
  AuthorizationStatus,
  EventType,
} from '@notifee/react-native'

const CHANNEL_ID = 'jag-quick-entry'
const NOTIFICATION_ID = 'jag-quick-entry-persistent'

export async function showQuickEntryNotification() {
  // Request permission (Android 13+)
  const settings = await notifee.requestPermission()
  if (
    settings.authorizationStatus !== AuthorizationStatus.AUTHORIZED &&
    settings.authorizationStatus !== AuthorizationStatus.PROVISIONAL
  ) {
    return
  }

  // Cancel the boot-receiver notification to avoid duplicates
  await notifee.cancelDisplayedNotification('jag-boot-1')

  await notifee.createChannel({
    id: CHANNEL_ID,
    name: 'Quick Entry',
    importance: AndroidImportance.DEFAULT,
    vibration: false,
    visibility: AndroidVisibility.PUBLIC,
  })

  await notifee.displayNotification({
    id: NOTIFICATION_ID,
    title: '<b>JAG Mobile</b>',
    body: 'Tap + to log an expense instantly',
    android: {
      channelId: CHANNEL_ID,
      ongoing: true,
      smallIcon: 'ic_notification',
      color: '#3b82f6',
      importance: AndroidImportance.DEFAULT,
      pressAction: { id: 'open', launchActivity: 'default' },
      actions: [
        {
          title: '+ New Expense',
          pressAction: { id: 'new-expense', launchActivity: 'default' },
        },
      ],
    },
  })
}

export function registerForegroundHandler(onNewExpense: () => void) {
  return notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.ACTION_PRESS && detail.pressAction?.id === 'new-expense') {
      onNewExpense()
    }
  })
}
