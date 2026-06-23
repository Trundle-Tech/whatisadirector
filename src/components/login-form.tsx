import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function LoginForm({
  className,
  error,
  isLoading = false,
  onSubmit,
  onSignUp,
  onGoogleSignIn,
  ...props
}: Omit<React.ComponentProps<"div">, "onSubmit"> & {
  error?: string
  isLoading?: boolean
  onSubmit: (credentials: { email: string; password: string }) => void
  onSignUp?: (credentials: { email: string; password: string }) => void
  onGoogleSignIn?: () => void
}) {
  const [isSignUp, setIsSignUp] = React.useState(false)
  const [localError, setLocalError] = React.useState("")

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLocalError("")
    const formData = new FormData(event.currentTarget)
    const email = String(formData.get("email") ?? "")
    const password = String(formData.get("password") ?? "")

    if (isSignUp) {
      const confirmPassword = String(formData.get("confirmPassword") ?? "")
      if (password !== confirmPassword) {
        setLocalError("Passwords do not match")
        return
      }
      if (onSignUp) {
        onSignUp({ email, password })
      }
    } else {
      onSubmit({ email, password })
    }
  }

  const activeError = localError || error

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden p-0">
        <CardContent className="grid p-0 md:grid-cols-2">
          <form className="p-6 md:p-8" onSubmit={handleSubmit}>
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <h1 className="text-2xl font-bold">
                  {isSignUp ? "Create account" : "Welcome back"}
                </h1>
                <p className="text-balance text-muted-foreground">
                  {isSignUp
                    ? "Enter your details to register for What is a Director"
                    : "Sign in to What is a Director"}
                </p>
              </div>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  name="email"
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  autoComplete="email"
                  required
                />
              </Field>
              <Field>
                <div className="flex items-center">
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  {!isSignUp && (
                    <a
                      href="#login"
                      className="ml-auto text-sm underline-offset-2 hover:underline"
                    >
                      Forgot your password?
                    </a>
                  )}
                </div>
                <Input
                  name="password"
                  id="password"
                  type="password"
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  required
                />
              </Field>
              {isSignUp && (
                <Field>
                  <FieldLabel htmlFor="confirmPassword">Confirm Password</FieldLabel>
                  <Input
                    name="confirmPassword"
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                </Field>
              )}
              {activeError ? <FieldError>{activeError}</FieldError> : null}
              <Field>
                <Button type="submit" disabled={isLoading} className="w-full">
                  {isLoading
                    ? isSignUp
                      ? "Creating account..."
                      : "Signing in..."
                    : isSignUp
                    ? "Sign Up"
                    : "Login"}
                </Button>
              </Field>
              {onGoogleSignIn && (
                <>
                  <div className="relative flex py-2 items-center">
                    <div className="flex-grow border-t border-muted" />
                    <span className="flex-shrink mx-4 text-muted-foreground text-xs uppercase">
                      Or continue with
                    </span>
                    <div className="flex-grow border-t border-muted" />
                  </div>
                  <Field>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full flex items-center justify-center gap-2"
                      onClick={onGoogleSignIn}
                      disabled={isLoading}
                    >
                      <svg className="h-4 w-4" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512">
                        <path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"></path>
                      </svg>
                      {isSignUp ? "Sign up with Google" : "Sign in with Google"}
                    </Button>
                  </Field>
                </>
              )}
              <div className="text-center text-sm text-muted-foreground mt-2">
                {isSignUp ? "Already have an account? " : "Don't have an account? "}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(!isSignUp)
                    setLocalError("")
                  }}
                  className="font-medium text-primary hover:underline bg-transparent border-0 p-0 cursor-pointer"
                >
                  {isSignUp ? "Sign In" : "Sign Up"}
                </button>
              </div>
            </FieldGroup>
          </form>
          <div className="relative hidden bg-muted md:flex md:flex-col md:justify-between md:p-8">
            <div>
              <div className="text-lg font-semibold">What is a Director</div>
              <p className="mt-2 text-sm text-muted-foreground">
                Ingestion, review, approval, and audit trails for operational
                SOP, MOP, and EOP documents.
              </p>
            </div>
            <div className="grid gap-3 text-sm">
              <div className="rounded-lg border bg-background/70 p-3">
                Firestore-backed review queue
              </div>
              <div className="rounded-lg border bg-background/70 p-3">
                Server-side application boundary
              </div>
              <div className="rounded-lg border bg-background/70 p-3">
                Version history and chain of custody
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      <FieldDescription className="px-6 text-center">
        Access is governed by Firebase Authentication and Firestore security
        rules.
      </FieldDescription>
    </div>
  )
}

