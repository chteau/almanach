import styles from './Logo.module.css';

/**
 * Renders the Almanach mark (a sundial, one ray highlighted) followed by the name
 *
 * @returns {JSX.Element} - the logo
 */
export function Logo() {
  return (
    <span className={styles.logo}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="none" strokeLinecap="round">
        <path
          d="M11 4.5V1M14.25 5.37L16 2.34M16.63 7.75L19.66 6M17.5 11H21M16.63 14.25L19.66 16M14.25 16.63L16 19.66M11 17.5V21M7.75 16.63L6 19.66M5.37 14.25L2.34 16M4.5 11H1M7.75 5.37L6 2.34"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path d="M5.37 7.75L2.34 6" stroke="var(--accent)" strokeWidth="2" />
        <circle cx="11" cy="11" r="1.6" fill="currentColor" />
      </svg>
      <span className={styles.name}>Almanach</span>
    </span>
  );
}
