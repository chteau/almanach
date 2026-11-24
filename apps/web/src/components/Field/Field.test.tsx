import { describe, expect, test } from 'bun:test';
import { render, setupDom } from '../../test/dom.tsx';
import { Field } from './Field.tsx';

setupDom();

describe('Field', () => {
  test('ties the label, error and hint to the control', () => {
    const { container } = render(
      <Field label="Name" hint="As on invoices" error="Required" width="half">
        {(control) => <input {...control} />}
      </Field>,
    );
    const input = container.querySelector('input');
    const label = container.querySelector('label');
    expect(label?.htmlFor).toBe(input?.id ?? 'missing');
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    const described = (input?.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Required',
      'As on invoices',
    ]);
  });

  test('checkbox layout puts the control before its label, without describedby when there is no help', () => {
    const { container } = render(
      <Field label="Send reminders" checkbox>
        {(control) => <input type="checkbox" {...control} />}
      </Field>,
    );
    expect(container.querySelector('div')?.firstElementChild?.tagName).toBe('INPUT');
    expect(container.querySelector('input')?.hasAttribute('aria-describedby')).toBe(false);
    expect(container.querySelector('input')?.hasAttribute('aria-invalid')).toBe(false);
  });
});
