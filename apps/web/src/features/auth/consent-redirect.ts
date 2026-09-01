type ConsentLocation = {
  pathname: string;
  search: string;
};

export function createConsentRedirectHandler(
  replace: (destination: string) => void,
  getLocation: () => ConsentLocation,
  beforeRedirect: () => void = () => {},
): () => void {
  let redirecting = false;

  return () => {
    if (redirecting) return;
    const { pathname, search } = getLocation();
    if (pathname === "/terms") return;
    redirecting = true;
    beforeRedirect();
    replace(`/terms?next=${encodeURIComponent(`${pathname}${search}`)}`);
  };
}
