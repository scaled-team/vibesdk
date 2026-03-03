import type { RouteObject } from 'react-router';
import React, { Suspense } from 'react';
import { Navigate, useParams } from 'react-router';

import App from './App';
import Home from './routes/home';
import { ProtectedRoute } from './routes/protected-route';

// Lazy-load heavy routes to reduce initial bundle size
const Chat = React.lazy(() => import('./routes/chat/chat'));
const Profile = React.lazy(() => import('./routes/profile'));
const Settings = React.lazy(() => import('./routes/settings'));
const AppsPage = React.lazy(() => import('./routes/apps'));


/** Redirects /app/:id to /chat/:id */
function RedirectAppToChat() {
	const { id } = useParams();
	return React.createElement(Navigate, { to: `/chat/${id}`, replace: true });
}

/** Minimal loading fallback for lazy routes */
function RouteFallback() {
	return React.createElement('div', {
		style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }
	});
}

/** Wrap a lazy component in Suspense */
function lazy(Component: React.LazyExoticComponent<React.ComponentType>) {
	return React.createElement(Suspense, { fallback: React.createElement(RouteFallback) },
		React.createElement(Component)
	);
}

const routes = [
	{
		path: '/',
		Component: App,
		children: [
			{
				index: true,
				Component: Home,
			},
			{
				path: 'chat/:chatId',
				element: lazy(Chat),
			},
			{
				path: 'profile',
				element: React.createElement(ProtectedRoute, { children: lazy(Profile) }),
			},
			{
				path: 'settings',
				element: React.createElement(ProtectedRoute, { children: lazy(Settings) }),
			},
			{
				path: 'apps',
				element: React.createElement(ProtectedRoute, { children: lazy(AppsPage) }),
			},
			{
				// Redirect /app/:id → /chat/:id (editor has everything)
				path: 'app/:id',
				Component: RedirectAppToChat,
			},
			{
				path: 'discover',
				element: React.createElement(Navigate, { to: '/', replace: true }),
			},
		],
	},
] satisfies RouteObject[];

export { routes };
