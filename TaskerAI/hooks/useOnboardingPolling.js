import { useEffect } from 'react';
import useAuthStore from '../store/authStore';

export default function useOnboardingPolling() {
  const session = useAuthStore((s) => s.session);
  const wizardStep = useAuthStore((s) => s.wizardStep);
  const _startPoll = useAuthStore((s) => s._startPoll);
  const _clearPoll = useAuthStore((s) => s._clearPoll);

  useEffect(() => {
    // The store starts the poll via bootstrapUser/handleWizardComplete.
    // This hook's only job is to clear the interval when the screen unmounts.
    if (wizardStep !== 'progress') return;
    return () => _clearPoll();
  }, [wizardStep]);
}
