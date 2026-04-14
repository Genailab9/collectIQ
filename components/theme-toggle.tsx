"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle() {
  const { mode, toggleMode } = useTheme();
  return (
    <Button variant="secondary" size="sm" onClick={toggleMode} aria-label="Toggle dark mode">
      {mode === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
      <span className="ml-2">{mode === "dark" ? "Light" : "Dark"}</span>
    </Button>
  );
}

