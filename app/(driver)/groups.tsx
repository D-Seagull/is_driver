import { useTranslation } from 'react-i18next';

import { ScreenPlaceholder } from '@/components/screen-placeholder';

export default function GroupsScreen() {
  const { t } = useTranslation();
  return (
    <ScreenPlaceholder
      icon="people-outline"
      title={t('nav.groups')}
      subtitle={t('groups.placeholderSubtitle')}
    />
  );
}
