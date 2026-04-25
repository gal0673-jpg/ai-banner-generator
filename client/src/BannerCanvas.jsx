import DynamicBannerCanvas from './DynamicBannerCanvas.jsx'

/** @deprecated Prefer `<DynamicBannerCanvas designType={1} … />` */
export default function BannerCanvas(props) {
  return <DynamicBannerCanvas designType={1} {...props} />
}
