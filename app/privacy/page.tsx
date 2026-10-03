import Studio from '../studio-client';
export default function Privacy() {
  return <Studio initialView="privacy" contact={process.env.PRIVACY_CONTACT || ''} />;
}
