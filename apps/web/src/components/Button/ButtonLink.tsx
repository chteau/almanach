import { Link, type LinkProps } from 'react-router';
import { type ButtonVariant, buttonClassName } from './Button.tsx';

interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
}

/**
 * Renders a router link that looks like a button: navigation keeps link semantics
 *
 * @param props {ButtonLinkProps} - router link props plus the visual variant
 * @returns {JSX.Element} - the link
 */
export function ButtonLink({ variant = 'primary', className, ...rest }: ButtonLinkProps) {
  return (
    <Link
      className={buttonClassName(variant, typeof className === 'string' ? className : undefined)}
      {...rest}
    />
  );
}
