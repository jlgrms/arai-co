import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import StyleGuidePage from './dev/style-guide';

// Router is scaffolded now (Layer 5, sub-item 2 fleshes out the full route tree
// and app shell). For this sub-item only the dev style-guide route is mounted.
const router = createBrowserRouter([
  {
    path: '/dev/style-guide',
    element: <StyleGuidePage />,
  },
  {
    path: '*',
    element: (
      <div className="flex min-h-screen items-center justify-center bg-background p-8">
        <p className="text-sm text-muted-foreground">
          App shell arrives in the next step. Style reference:{" "}
          <a className="underline" href="/dev/style-guide">
            /dev/style-guide
          </a>
        </p>
      </div>
    ),
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
