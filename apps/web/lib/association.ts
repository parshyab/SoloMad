const bundleID = "app.solomad.ios";

export function associationDocument(teamID: string | undefined) {
  if (!teamID || !/^[A-Z0-9]{10}$/.test(teamID)) return null;
  return {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [`${teamID}.${bundleID}`],
          components: [{ "/": "/a/*", comment: "Shared activities only" }],
        },
      ],
    },
  };
}
