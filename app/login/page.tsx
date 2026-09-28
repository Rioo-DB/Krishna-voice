import LoginForm from "./LoginForm";

export default async function Login({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return <LoginForm linkError={Boolean(error)} />;
}
