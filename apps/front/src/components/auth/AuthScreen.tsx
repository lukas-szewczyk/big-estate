import * as React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type AuthField = {
  autocomplete: string;
  label: string;
  name: string;
  placeholder: string;
  type: React.HTMLInputTypeAttribute;
};

type AuthLink = {
  href: string;
  label: string;
};

type AuthScreenProps = {
  actionHref: string;
  actionLabel: string;
  actionLinkLabel: string;
  apiBaseUrl: string;
  busyLabel: string;
  cardWidthClassName: string;
  endpoint: string;
  footerLinks: AuthLink[];
  footerNote: string;
  isRegister: boolean;
  kicker: string;
  note: string;
  pageTitle: string;
  primaryActionLabel: string;
  secondaryActionHref: string;
  secondaryActionLabel: string;
  subtitle: string;
  successPath: string;
};

const loginFields: AuthField[] = [
  {
    autocomplete: "email",
    label: "Email or phone",
    name: "email",
    placeholder: "name@example.com",
    type: "email",
  },
  {
    autocomplete: "current-password",
    label: "Password",
    name: "password",
    placeholder: "Enter your password",
    type: "password",
  },
];

const registerFields: AuthField[] = [
  {
    autocomplete: "email",
    label: "Email",
    name: "email",
    placeholder: "name@example.com",
    type: "email",
  },
  {
    autocomplete: "new-password",
    label: "Password",
    name: "password",
    placeholder: "Create a password",
    type: "password",
  },
  {
    autocomplete: "new-password",
    label: "Confirm password",
    name: "confirmPassword",
    placeholder: "Repeat your password",
    type: "password",
  },
];

const providers = ["Google", "Apple"];

export default function AuthScreen({
  actionHref,
  actionLabel,
  actionLinkLabel,
  apiBaseUrl,
  busyLabel,
  cardWidthClassName,
  endpoint,
  footerLinks,
  footerNote,
  isRegister,
  kicker,
  note,
  pageTitle,
  primaryActionLabel,
  secondaryActionHref,
  secondaryActionLabel,
  subtitle,
  successPath,
}: AuthScreenProps) {
  const fields = isRegister ? registerFields : loginFields;

  return (
    <main className="flex min-h-full items-center justify-center bg-background px-6 py-12 sm:px-8">
      <div className="flex w-full max-w-6xl justify-center">
        <div
          className={cn(
            "flex w-full flex-col items-center gap-6 text-center",
            cardWidthClassName,
          )}
        >
          <div className="space-y-10">
            <div className="space-y-4">
              <p className="font-primary text-[0.7rem] font-semibold tracking-[0.22em] text-muted-foreground">
                {kicker}
              </p>
              <Card className="border border-border bg-card/95 shadow-sm">
                <CardHeader className="items-center border-b border-border/70 px-7 pt-7 pb-2 text-center">
                  <CardTitle className="text-3xl font-medium tracking-tight text-foreground">
                    {pageTitle}
                  </CardTitle>
                  <CardDescription className="max-w-sm text-sm leading-6">
                    {subtitle}
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6 px-7 py-7">
                  <section className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {providers.map((provider) => (
                        <Button
                          key={provider}
                          className="w-full"
                          disabled
                          type="button"
                          variant="outline"
                        >
                          {provider}
                        </Button>
                      ))}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <div className="h-px flex-1 bg-border" />
                      <span>or continue with</span>
                      <div className="h-px flex-1 bg-border" />
                    </div>
                  </section>

                  <form
                    className="space-y-4 text-left"
                    data-auth-form
                    data-api-base-url={apiBaseUrl}
                    data-busy-label={busyLabel}
                    data-endpoint={endpoint}
                    data-mode={isRegister ? "register" : "login"}
                    data-success-path={successPath}
                  >
                    <FieldGroup>
                      {fields.map((field) => (
                        <Field key={field.name}>
                          <FieldLabel htmlFor={field.name}>
                            {field.label}
                          </FieldLabel>
                          <Input
                            autoComplete={field.autocomplete}
                            id={field.name}
                            name={field.name}
                            placeholder={field.placeholder}
                            required
                            type={field.type}
                          />
                        </Field>
                      ))}

                      {isRegister ? (
                        <Field>
                          <label
                            className="flex items-start gap-3 text-sm leading-6 text-foreground"
                            htmlFor="terms"
                          >
                            <input
                              className="mt-1 size-4 rounded-[4px] border border-input accent-primary"
                              id="terms"
                              name="terms"
                              required
                              type="checkbox"
                            />
                            <span>I agree to the Terms and Privacy Policy</span>
                          </label>
                        </Field>
                      ) : null}
                    </FieldGroup>

                    {!isRegister ? (
                      <div className="flex justify-end">
                        <a
                          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                          href="#"
                        >
                          Forgot password?
                        </a>
                      </div>
                    ) : null}

                    <Alert
                      className="hidden"
                      data-auth-error
                      variant="destructive"
                    >
                      <AlertTitle>Could not continue</AlertTitle>
                      <AlertDescription data-auth-error-message />
                    </Alert>

                    <p className="text-sm leading-6 text-muted-foreground">
                      {note}
                    </p>

                    <CardFooter className="flex-col gap-2 border-0 bg-transparent p-0 pt-2 sm:flex-row sm:justify-end">
                      <a
                        className={cn(
                          buttonVariants({ variant: "outline" }),
                          "w-full sm:w-auto",
                        )}
                        href={secondaryActionHref}
                      >
                        {secondaryActionLabel}
                      </a>
                      <Button
                        className="w-full sm:w-auto"
                        data-submit-button
                        type="submit"
                      >
                        <span data-submit-label>{primaryActionLabel}</span>
                      </Button>
                    </CardFooter>
                  </form>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <p>{footerNote}</p>
              <div className="flex flex-wrap items-center justify-center gap-5">
                {footerLinks.map((link) => (
                  <a
                    key={link.label}
                    className="hover:text-foreground"
                    href={link.href}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{actionLabel}</span>
            <a
              className="font-medium text-foreground underline-offset-4 hover:underline"
              href={actionHref}
            >
              {actionLinkLabel}
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
