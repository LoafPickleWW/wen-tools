import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.querySelector("#root")?.scrollIntoView();
  }, [pathname]);

  return null;
}
