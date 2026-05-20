import { ScreenPlaceholder } from '@/components/screen-placeholder';
import { useUser } from '@/store/auth';

export default function ChatScreen() {
  const user = useUser();
  const hasTruck = !!user?.currentTruck;
  const managerName = user?.manager?.name ?? 'your manager';

  // Different framing depending on whether the driver landed here as the
  // primary screen (no truck) or navigated in via the sidebar.
  if (!hasTruck) {
    return (
      <ScreenPlaceholder
        icon="chatbubble-ellipses-outline"
        title={`Chat with ${managerName}`}
        subtitle="No truck is assigned yet. Reach out to your manager — they'll set you up."
      />
    );
  }

  return (
    <ScreenPlaceholder
      icon="chatbubbles-outline"
      title="Drivers chat"
      subtitle="Driver-to-driver chat. The current manager is pinned to the top."
    />
  );
}
