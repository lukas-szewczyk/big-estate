function showError(target: HTMLElement | null, message: string) {
  if (!target) {
    return;
  }

  target.textContent = message;
  target.closest("[data-auth-error]")?.classList.remove("hidden");
}

function hideError(target: HTMLElement | null) {
  if (!target) {
    return;
  }

  target.textContent = "";
  target.closest("[data-auth-error]")?.classList.add("hidden");
}

export function mountAuthForm() {
  const form = document.querySelector<HTMLFormElement>("[data-auth-form]");
  if (!form) {
    return;
  }

  const apiBaseUrl = form.dataset.apiBaseUrl ?? "";
  const endpoint = form.dataset.endpoint ?? "";
  const successPath = form.dataset.successPath ?? "/dashboard";
  const submitButton = form.querySelector<HTMLButtonElement>(
    "[data-submit-button]",
  );
  const submitLabel = form.querySelector<HTMLElement>("[data-submit-label]");
  const errorMessage = form.querySelector<HTMLElement>(
    "[data-auth-error-message]",
  );
  const busyLabel = form.dataset.busyLabel ?? "Working...";
  const idleLabel =
    submitLabel?.textContent ?? submitButton?.textContent ?? "Continue";
  const mode = form.dataset.mode ?? "login";

  form.addEventListener("input", () => hideError(errorMessage));
  form.addEventListener("change", () => hideError(errorMessage));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!form.reportValidity()) {
      return;
    }

    const formData = new FormData(form);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (mode === "register" && password !== confirmPassword) {
      showError(errorMessage, "Passwords do not match. Please re-enter them.");
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
    }

    if (submitLabel) {
      submitLabel.textContent = busyLabel;
    } else if (submitButton) {
      submitButton.textContent = busyLabel;
    }

    hideError(errorMessage);

    try {
      const response = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: String(formData.get("email") ?? ""),
          password,
        }),
      });

      if (response.ok) {
        window.location.assign(successPath);
        return;
      }

      let message = "Something went wrong. Please try again.";

      try {
        const body = (await response.json()) as {
          error?: { message?: string };
        };
        if (body?.error?.message) {
          message = String(body.error.message);
        }
      } catch {
        // Fall back to the generic error.
      }

      showError(errorMessage, message);
    } catch {
      showError(
        errorMessage,
        "Authentication service is unavailable right now.",
      );
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }

      if (submitLabel) {
        submitLabel.textContent = idleLabel;
      } else if (submitButton) {
        submitButton.textContent = idleLabel;
      }
    }
  });
}
