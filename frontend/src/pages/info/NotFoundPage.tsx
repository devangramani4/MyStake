import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/ui/States';

export default function NotFoundPage() {
  return <div className="page"><EmptyState title="Page not found" message="The page you're looking for doesn't exist." action={<Link to="/" className="btn btn-primary">Go home</Link>} /></div>;
}
