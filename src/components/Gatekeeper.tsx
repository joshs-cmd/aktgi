import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2 } from "lucide-react";
import { lovable } from "@/integrations/lovable/index";
import aktLogo from "@/assets/aktlogo.png";

interface GatekeeperProps {
  onSuccess: () => void;
  error?: string | null;
}

export const Gatekeeper = ({ onSuccess, error: externalError }: GatekeeperProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayError = externalError || error;

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
        extraParams: {
          hd: "*",
          prompt: "select_account",
        },
      });

      if (result.error) {
        setError("Sign-in failed. Please try again.");
        setIsLoading(false);
        return;
      }

      if (!result.redirected) {
        onSuccess();
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div className="flex justify-center">
          <img src={aktLogo} alt="AKT Enterprises" className="h-20 w-auto" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            AKT Garment Inventory
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in with your company Google account
          </p>
        </div>

        {displayError && (
          <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-lg p-3">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{displayError}</span>
          </div>
        )}

        <Button
          onClick={handleGoogleSignIn}
          disabled={isLoading}
          className="w-full h-12 text-base font-medium gap-3"
          variant="outline"
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
          )}
          {isLoading ? "Signing in..." : "Sign in with Google"}
        </Button>

        <p className="text-xs text-muted-foreground">
          Access is restricted to authorized company domains.
        </p>
      </div>
    </div>
  );
};
