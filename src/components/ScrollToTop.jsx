import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.querySelector("#Header").scrollIntoView();
  }, [pathname]);

  return null;
}
