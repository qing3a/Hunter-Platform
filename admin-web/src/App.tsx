import { BrowserRouter } from 'react-router-dom';

export default function App() {
  return (
    <BrowserRouter basename="/admin">
      <div className="container">
        <h1>Hunter Platform Admin (skeleton)</h1>
        <p>Task 7 skeleton — pages added in Task 8.</p>
      </div>
    </BrowserRouter>
  );
}
