import { useEffect } from 'react';
import useAuthStore from '../store/authStore';

export default function useOnboardingPolling() {
  const session = useAuthStore((s) => s.session);
  const wizardStep = useAuthStore((s) => s.wizardStep);
  const _startPoll = useAuthStore((s) => s._startPoll);
  const _clearPoll = useAuthStore((s) => s._clearPoll);

  useEffect(() => {
    if (wizardStep !== 'progress' || !session) return;
    _startPoll(session);
    return () => _clearPoll();
  }, [wizardStep, session]);
}
