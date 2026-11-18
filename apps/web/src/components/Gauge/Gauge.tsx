import styles from './Gauge.module.css';

interface GaugeProps {
  label: string;
  /** Share reached, in basis points (10000 = 100 %); may exceed 100 %. */
  valueBp: number;
  /** Text read next to the bar, e.g. "18 400 € of 37 500 €". */
  detail: string;
}

/**
 * Progress bar for a threshold, readable by screen readers and never relying on colour alone
 *
 * @param props {GaugeProps} - label, value and detail text
 * @returns {JSX.Element} - the gauge
 */
export function Gauge({ label, valueBp, detail }: GaugeProps) {
  const percent = Math.round(valueBp / 100);
  const tone = valueBp >= 10_000 ? styles.over : valueBp >= 8_000 ? styles.near : styles.ok;
  return (
    <div className={styles.gauge}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <strong>{percent} %</strong>
      </div>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, percent)}
        aria-valuetext={`${percent} % — ${detail}`}
      >
        <div className={`${styles.bar} ${tone}`} style={{ width: `${Math.min(100, valueBp / 100)}%` }} />
      </div>
      <p className={styles.detail}>{detail}</p>
    </div>
  );
}
