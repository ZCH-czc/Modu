import { useCallback, useEffect, useState } from "react";

import { completeSpotlightGuide, hasCompletedSpotlightGuide } from "../services/spotlightGuides";

export function useSpotlightGuide(id: string, enabled: boolean, resetToken = 0) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let active = true;
    if (!enabled) {
      setVisible(false);
      return () => { active = false; };
    }
    void hasCompletedSpotlightGuide(id).then((completed) => {
      if (active) setVisible(!completed);
    });
    return () => { active = false; };
  }, [enabled, id, resetToken]);

  const complete = useCallback(() => {
    setVisible(false);
    void completeSpotlightGuide(id);
  }, [id]);

  return { visible, complete };
}
