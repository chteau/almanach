export const INSTALL_STEPS = ['language', 'token', 'checks', 'admin', 'instance', 'summary'] as const;
export type InstallStep = (typeof INSTALL_STEPS)[number];

/** Values collected across the wizard; held in memory only, never persisted in the browser. */
export interface InstallForm {
  token: string;
  admin: { email: string; password: string };
  instance: { name: string; publicUrl: string; timezone: string };
}

/** Props every step receives from the wizard. */
export interface StepProps {
  form: InstallForm;
  update: (patch: Partial<InstallForm>) => void;
  next: () => void;
  back: () => void;
  goTo: (step: InstallStep) => void;
}
