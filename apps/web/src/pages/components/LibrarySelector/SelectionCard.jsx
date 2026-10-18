import { useState } from "react";
import axios from "../../../lib/axios_instance";
import "../../css/library/library-card.css";

import { Form, Card, Row, Col } from "react-bootstrap";

import { Trans } from "react-i18next";
import baseUrl from "../../../lib/baseurl";
import { libraryTypeMeta } from "../../../lib/library-types";

function SelectionCard(props) {
  const [imageLoaded, setImageLoaded] = useState(true);
  const [checked, setChecked] = useState(props.data.Tracked);
  const token = localStorage.getItem("token");
  const libraryMeta = libraryTypeMeta(props.data.CollectionType);
  const TypeIcon = libraryMeta.icon;
  const libraryType = libraryMeta.name;
  const default_image = (
    <div className="default_library_image-inv d-flex justify-content-center align-items-center">
      <TypeIcon size={"50%"} color="white" />{" "}
    </div>
  );

  const handleChange = async () => {
    await axios
      .post(
        "/api/setExcludedLibraries",
        {
          libraryID: props.data.Id,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      )
      .then(() => {
        setChecked((current) => !current);
      })
      .catch((error) => {
        console.error(error);
      });
  };

  return (
    <Card className={`bg-transparent lib-card selector-library-card rounded-3 ${checked ? "is-tracked" : "is-untracked"}`}>
      <div className="library-card-image selector-library-image">
        {imageLoaded ? (
          <Card.Img
            variant="top"
            className="library-card-banner default_library_image"
            src={baseUrl + "/proxy/Items/Images/Primary?id=" + props.data.Id + "&fillWidth=520&quality=48"}
            loading="lazy"
            decoding="async"
            onError={() => setImageLoaded(false)}
          />
        ) : (
          default_image
        )}
        <div className="selector-library-overlay" />
      </div>

      <Card.Body className="library-card-details-inv rounded-bottom">
        <Row className="space-between-end card-row">
          <Col className="card-label">
            <Trans i18nKey={"LIBRARY_CARD.LIBRARY"} />
          </Col>
          <Col className="text-end">{props.data.Name}</Col>
        </Row>

        <Row className="space-between-end card-row">
          <Col className="card-label">
            <Trans i18nKey={"TYPE"} />
          </Col>
          <Col className="text-end">{libraryType}</Col>
        </Row>

        <Row className="space-between-end card-row">
          <Col className="card-label">
            <Trans i18nKey={"LIBRARY_CARD.TRACKED"} />
          </Col>
          <Col className="text-end">
            <Form>
              <Form.Check type="switch" checked={checked} onChange={handleChange} />
            </Form>
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
}

export default SelectionCard;
