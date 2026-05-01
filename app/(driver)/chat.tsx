import { ScreenPlaceholder } from '@/components/screen-placeholder';
import { useUser } from '@/store/auth';

export default function ChatScreen() {
  const user = useUser();
  const hasTruck = !!user?.currentTruck;
  const dispatcherName = user?.dispatcher?.name ?? 'your dispatcher';

  // Different framing depending on whether the driver landed here as the
  // primary screen (no truck) or navigated in via the sidebar.
  if (!hasTruck) {
    return (
      <ScreenPlaceholder
        icon="chatbubble-ellipses-outline"
        title={`Chat with ${dispatcherName}`}
        subtitle="No truck is assigned yet. Reach out to your dispatcher — they'll set you up."
      />
    );
  }

  return (
    <ScreenPlaceholder
      icon="chatbubbles-outline"
      title="Drivers chat"
      subtitle="Driver-to-driver chat. The current dispatcher is pinned to the top."
    />
  );
}
