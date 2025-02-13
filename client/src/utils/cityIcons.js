// const cityIconCache = {};

// const createColoredCityIconImage = (color) => {
//   // Render the icon with the fill color set to the given color.
//   const svgString = renderToStaticMarkup(<GiVillage fill={color} />);
//   const svgDataUrl =
//     "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
//   const img = new Image();
//   img.src = svgDataUrl;
//   return img;
// };

// const getCityIconForColor = (color) => {
//   if (!cityIconCache[color]) {
//     cityIconCache[color] = createColoredCityIconImage(color);
//   }
//   return cityIconCache[color];
// };
