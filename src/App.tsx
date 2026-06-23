import * as React from 'react';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppSidebar } from '@/components/app-sidebar';
import { SiteHeader } from '@/components/site-header';
import { IngestionPages, type AppRoute } from '@/components/ingestion-pages';
import { LoginForm } from '@/components/login-form';
import { Toaster } from '@/components/ui/sonner';
import {
  listenToAuthState,
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  syncUserToFirestore,
  signOutOfFirebase,
  listenToUserProfile,
} from '@/lib/firebase';
import { listenToUserNotifications } from '@/lib/firestore-store';
import type { User } from 'firebase/auth';

const routeTitles: Record<AppRoute, string> = {
  dashboard: 'Dashboard',
  ingestion: 'Ingestion',
  'review-queue': 'Review Queue',
  'publish-queue': 'Publish Queue',
  'operational-docs': 'Operational Docs',
  'audit-trail': 'Audit Trail',
  sops: 'SOP Library',
  mops: 'MOP Library',
  eops: 'EOP Library',
  login: 'Login',
  'user-management': 'User Management',
};

function getRoute(): AppRoute {
  const hash = window.location.hash.replace('#', '') as AppRoute;
  if (hash in routeTitles) {
    return hash;
  }
  return 'dashboard';
}

function canAccessRoute(role: string, targetRoute: AppRoute): boolean {
  if (!role) return false;
  if (role === 'Admin') return true;

  if (targetRoute === 'user-management' || targetRoute === 'audit-trail') {
    return false;
  }
  if (targetRoute === 'publish-queue') {
    return role === 'Approver';
  }
  if (targetRoute === 'review-queue') {
    return role === 'Approver' || role === 'Reviewer';
  }
  if (targetRoute === 'ingestion') {
    return role === 'Approver' || role === 'Reviewer' || role === 'Contributor';
  }
  return true;
}

export default function App() {
  const [route, setRoute] = React.useState<AppRoute>(() => getRoute());
  const [authUser, setAuthUser] = React.useState<User | null>(null);
  const [userProfile, setUserProfile] = React.useState<any>(null);
  const [notifications, setNotifications] = React.useState<any[]>([]);
  const [isAuthReady, setIsAuthReady] = React.useState(false);
  const [isLoggingIn, setIsLoggingIn] = React.useState(false);
  const [loginError, setLoginError] = React.useState('');

  React.useEffect(() => {
    const handleHashChange = () => setRoute(getRoute());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  React.useEffect(() => {
    let unsubProfile: (() => void) | undefined;
    let unsubNotifs: (() => void) | undefined;

    const unsubAuth = listenToAuthState(async (user) => {
      unsubProfile?.();
      unsubNotifs?.();
      unsubProfile = undefined;
      unsubNotifs = undefined;

      if (user) {
        try {
          await syncUserToFirestore(user);
        } catch (e) {
          console.error("Failed to sync user to Firestore:", e);
        }

        unsubProfile = listenToUserProfile(user.uid, (profile) => {
          setUserProfile(profile);
        });

        unsubNotifs = listenToUserNotifications(
          user.uid,
          (notifs) => {
            setNotifications(notifs);
          },
          (err) => console.error("Notifications listener error:", err)
        );
      } else {
        setUserProfile(null);
        setNotifications([]);
      }

      setAuthUser(user);
      setIsAuthReady(true);
      if (user && window.location.hash === '#login') {
        window.location.hash = '#dashboard';
      }
    });

    return () => {
      unsubAuth();
      unsubProfile?.();
      unsubNotifs?.();
    };
  }, []);

  React.useEffect(() => {
    if (userProfile && !canAccessRoute(userProfile.role, route)) {
      window.location.hash = '#dashboard';
    }
  }, [userProfile, route]);

  async function handleLogin(credentials: { email: string; password: string }) {
    setIsLoggingIn(true);
    setLoginError('');
    try {
      await signInWithEmail(credentials.email, credentials.password);
      window.location.hash = '#dashboard';
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Unable to sign in');
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleSignUp(credentials: { email: string; password: string; name: string; department: string }) {
    setIsLoggingIn(true);
    setLoginError('');
    try {
      const user = await signUpWithEmail(credentials.email, credentials.password);
      if (user) {
        await syncUserToFirestore(user, credentials.name, credentials.department);
      }
      window.location.hash = '#dashboard';
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Unable to create account');
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleGoogleSignIn() {
    setIsLoggingIn(true);
    setLoginError('');
    try {
      await signInWithGoogle();
      window.location.hash = '#dashboard';
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Unable to sign in with Google');
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleSignOut() {
    await signOutOfFirebase();
    window.location.hash = '#login';
  }

  if (!isAuthReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="text-sm text-muted-foreground">Checking authentication...</div>
      </div>
    );
  }

  if (!authUser || route === 'login') {
    return (
      <TooltipProvider>
        <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
          <LoginForm
            className="w-full max-w-4xl"
            error={loginError}
            isLoading={isLoggingIn}
            onSubmit={handleLogin}
            onSignUp={handleSignUp}
            onGoogleSignIn={handleGoogleSignIn}
          />
        </div>
        <Toaster />
      </TooltipProvider>
    );
  }

  if (authUser && !userProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="text-sm text-muted-foreground">Loading user profile...</div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <div className="flex min-h-screen w-full bg-background text-foreground">
          <AppSidebar
            userProfile={userProfile}
            user={{
              name: userProfile?.name || authUser.displayName || authUser.email || 'Signed-in user',
              email: authUser.email || authUser.uid,
              avatar: '',
            }}
            onSignOut={handleSignOut}
          />
          <SidebarInset className="flex flex-col flex-1">
            <SiteHeader
              title={routeTitles[route]}
              userProfile={userProfile}
              notifications={notifications}
            />
            <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 min-h-0">
              <IngestionPages route={route} userProfile={userProfile} />
            </div>
          </SidebarInset>
        </div>
        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  );
}
