import { describe, expect, test } from 'bun:test';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { render, setupDom } from '../../test/dom.tsx';
import { Button } from './Button.tsx';
import { ButtonLink } from './ButtonLink.tsx';

setupDom();

describe('Button', () => {
  test('renders a native button that defaults to type="button"', () => {
    const { container } = render(<Button variant="danger">Delete</Button>);
    const button = container.querySelector('button');
    expect(button?.type).toBe('button');
    expect(button?.textContent).toBe('Delete');
  });

  test('busy disables the button, announces it and shows the saving label', () => {
    const { container } = render(<Button busy>Save</Button>);
    const button = container.querySelector('button');
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(button?.textContent).toBe('Saving…');
  });
});

describe('ButtonLink', () => {
  test('keeps link semantics', () => {
    const router = createMemoryRouter([
      {
        path: '/',
        element: (
          <ButtonLink to="/new" variant="subtle">
            New
          </ButtonLink>
        ),
      },
    ]);
    const { container } = render(<RouterProvider router={router} />);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/new');
  });
});
