"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return <main style={{maxWidth:640,margin:"12vh auto",padding:24,fontFamily:"sans-serif"}}>
    <h1>LinkMatch could not display the workspace</h1>
    <p>Your last completed local autosave is kept in this browser. Changes made before the last save completed may not be recoverable.</p>
    <p>You can retry the display or reload to restore the saved workspace. Do not clear your browser's site data.</p>
    <button onClick={reset}>Retry display</button>{" "}
    <button onClick={() => window.location.reload()}>Reload saved workspace</button>
  </main>;
}
